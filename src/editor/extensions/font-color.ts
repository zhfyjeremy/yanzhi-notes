import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * 文字颜色(PRD §10 方言:`<font color="#e05c5c">文字</font>`,语雀式预设色卡)。
 * md 管线原样保留任意色值(尊重文件内容);粘贴的外部颜色在 paste-clean 吸附到最近预设色。
 * 兼容解析 span[style*=color](语雀/网页复制的常见形态),写出统一为 font 标签。
 */

export interface FontColorDef {
  value: string;
  label: string;
}

/** 预设色卡(语雀观感,中亮度兼顾深浅模式) */
export const FONT_COLORS: readonly FontColorDef[] = [
  { value: "#e05c5c", label: "红" },
  { value: "#e6a23c", label: "橙" },
  { value: "#c9a018", label: "黄" },
  { value: "#4ea832", label: "绿" },
  { value: "#29a8ab", label: "青" },
  { value: "#3b82f6", label: "蓝" },
  { value: "#8e5cd9", label: "紫" },
  { value: "#8f959e", label: "灰" },
];

/** CSS 基本命名色(Word/网页粘贴常见形态),仅覆盖与色卡相关的常用项 */
const CSS_NAMED_COLORS: Record<string, string> = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080",
  white: "#ffffff", maroon: "#800000", red: "#ff0000", orange: "#ffa500",
  yellow: "#ffff00", olive: "#808000", lime: "#00ff00", green: "#008000",
  aqua: "#00ffff", cyan: "#00ffff", teal: "#008080", blue: "#0000ff",
  navy: "#000080", fuchsia: "#ff00ff", purple: "#800080",
};

/** 中性色(黑白灰)饱和度阈值:低于它视为普通正文色,粘贴时摘除不吸附 */
const NEUTRAL_SATURATION = 0.15;

/** 外部色值 → 最近预设色;黑白灰/非法色返回 null(摘除,不设 mark) */
export function nearestFontColor(raw: string): string | null {
  const hexToRgb = (hex: string): [number, number, number] | null => {
    const m = hex.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const h = m[0].length === 3
      ? m[0].split("").map((c) => c + c).join("")
      : m[0];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  // rgb()/rgba()、#hex、CSS 命名色三种常见形态
  const text = raw.trim().toLowerCase();
  const rgbMatch = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  const rgb = rgbMatch
    ? ([Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])] as [number, number, number])
    : hexToRgb(text) ?? (CSS_NAMED_COLORS[text] ? hexToRgb(CSS_NAMED_COLORS[text]) : null);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  // 黑白灰与正文色无异,吸附反而制造噪色 → 摘除
  const max = Math.max(r, g, b);
  if (max === 0 || (max - Math.min(r, g, b)) / max < NEUTRAL_SATURATION) return null;
  let best: FontColorDef | null = null;
  let bestDist = Infinity;
  for (const def of FONT_COLORS) {
    const [pr, pg, pb] = hexToRgb(def.value)!;
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = def;
    }
  }
  return best?.value ?? null;
}

/** 从 span 的 style 里提取 color 值(粘贴路径) */
export function colorFromStyle(style: string): string | null {
  const m = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return m ? m[1].trim() : null;
}

export const FontColor = Mark.create({
  name: "fontColor",

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("color") ?? colorFromStyle(element.getAttribute("style") ?? ""),
        renderHTML: (attributes) => ({ color: attributes.color }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "font[color]" },
      { tag: "span[style*=color]" },
      { tag: "span[style*=COLOR]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["font", mergeAttributes(HTMLAttributes), 0];
  },
});
