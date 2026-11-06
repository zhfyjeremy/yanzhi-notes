"""
把用户提供的安装包 logo 做成全出血透明底源图。
四边已透明时只删角落水印碎块再裁切;不透明白底/黑底才从边缘洪水填充。
近白洪水不能穿过透明像素,否则会把图标内部的白纸一并抠掉。
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(__file__).resolve().parents[1] / "docs" / "icon-concepts" / "user-logo-md-tray-raw.png"
OUT_DIR = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
SOURCE_OUT = OUT_DIR / "icon-source.png"
PREVIEW_OUT = OUT_DIR / "_preview-icon-source.png"


def is_near_white(pixel: tuple[int, int, int, int], tol: int = 18) -> bool:
    r, g, b, a = pixel
    return a > 8 and min(r, g, b) >= 255 - tol


def is_near_black(pixel: tuple[int, int, int, int], tol: int = 18) -> bool:
    r, g, b, a = pixel
    return a > 8 and max(r, g, b) <= tol


def edge_mat(im: Image.Image) -> str:
    """看四边是透明、近白还是近黑。透明底不能再按近白去灌,白纸会从缺口漏掉。"""
    w, h = im.size
    pix = im.load()
    samples = [pix[x, 0] for x in range(0, w, 8)]
    samples += [pix[x, h - 1] for x in range(0, w, 8)]
    samples += [pix[0, y] for y in range(0, h, 8)]
    samples += [pix[w - 1, y] for y in range(0, h, 8)]
    transparent = sum(1 for p in samples if p[3] <= 8)
    if transparent >= len(samples) * 0.8:
        return "transparent"
    white = sum(1 for p in samples if is_near_white(p))
    black = sum(1 for p in samples if is_near_black(p))
    if white >= black and white >= len(samples) * 0.5:
        return "white"
    if black >= len(samples) * 0.5:
        return "black"
    return "none"


def drop_small_components(im: Image.Image, min_pixels: int) -> None:
    """删除面积过小的连通不透明区域(角落水印等),原地改 alpha。"""
    w, h = im.size
    pix = im.load()
    seen = bytearray(w * h)

    def index(x: int, y: int) -> int:
        return y * w + x

    for y0 in range(h):
        for x0 in range(w):
            i0 = index(x0, y0)
            if seen[i0] or pix[x0, y0][3] <= 8:
                continue
            queue: deque[tuple[int, int]] = deque([(x0, y0)])
            seen[i0] = 1
            cells: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                cells.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    ni = index(nx, ny)
                    if seen[ni] or pix[nx, ny][3] <= 8:
                        continue
                    seen[ni] = 1
                    queue.append((nx, ny))
            if len(cells) < min_pixels:
                for x, y in cells:
                    r, g, b, _a = pix[x, y]
                    pix[x, y] = (r, g, b, 0)
                print(f"dropped component size={len(cells)} at {cells[0]}")


def remove_mat(im: Image.Image) -> Image.Image:
    w, h = im.size
    pix = im.load()
    mat = edge_mat(im)
    print(f"edge mat={mat}")
    visited = bytearray(w * h)

    def index(x: int, y: int) -> int:
        return y * w + x

    def matches(pixel: tuple[int, int, int, int]) -> bool:
        if mat == "white":
            return is_near_white(pixel)
        if mat == "black":
            return is_near_black(pixel)
        return False

    if mat in ("white", "black"):
        queue: deque[tuple[int, int]] = deque()

        def push(x: int, y: int) -> None:
            if not (0 <= x < w and 0 <= y < h):
                return
            i = index(x, y)
            if visited[i] or not matches(pix[x, y]):
                return
            visited[i] = 1
            queue.append((x, y))

        for x in range(w):
            push(x, 0)
            push(x, h - 1)
        for y in range(h):
            push(0, y)
            push(w - 1, y)

        while queue:
            x, y = queue.popleft()
            push(x - 1, y)
            push(x + 1, y)
            push(x, y - 1)
            push(x, y + 1)

    out = Image.new("RGBA", (w, h))
    op = out.load()
    bg_count = sum(visited)

    for y in range(h):
        for x in range(w):
            r, g, b, a = pix[x, y]
            if visited[index(x, y)]:
                op[x, y] = (r, g, b, 0)
                continue
            op[x, y] = (r, g, b, a)

    # 去掉与主图形断开的小碎块(常见于角落水印「豆包 AI 生成」)
    drop_small_components(out, min_pixels=max(2000, (w * h) // 200))

    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            if op[x, y][3] > 8:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)

    if maxx < minx:
        raise SystemExit("未能识别图标主体,请检查源图背景是否过杂")

    print(
        f"bg={bg_count / (w * h):.1%} bbox=({minx},{miny})-({maxx},{maxy}) "
        f"margins LRTB={minx},{w - 1 - maxx},{miny},{h - 1 - maxy}"
    )

    pad = 6
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    cropped = out.crop((minx, miny, maxx + 1, maxy + 1))
    cw, ch = cropped.size
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    return canvas


def assert_corners_transparent(im: Image.Image) -> None:
    px = im.load()
    w, h = im.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    print("corners", corners)
    if any(c[3] > 0 for c in corners):
        raise SystemExit("四角仍有不透明像素,白边未去干净")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"找不到源图: {SRC}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    canvas = remove_mat(im)
    assert_corners_transparent(canvas)
    canvas.save(SOURCE_OUT)
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(PREVIEW_OUT)
    print(f"square={canvas.size[0]} saved {SOURCE_OUT}")
    print(f"preview {PREVIEW_OUT}")


if __name__ == "__main__":
    main()
