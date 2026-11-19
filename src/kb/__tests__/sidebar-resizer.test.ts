import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { SidebarResizer } from "../SidebarResizer";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../../settings";

/**
 * 左栏可拖拽分隔条。
 *
 * 关注点:
 * - 拖动时宽度实时跟随鼠标(起点快照,不累积漂移)
 * - 宽度夹在 [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX]
 * - 拖动开始/结束各通知一次父级(父级据此关/开 transition、落盘)
 * - 双击复位 / 键盘 ←→ 微调
 */

describe("左栏可拖拽分隔条", () => {
  const roots: Root[] = [];

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  /** 挂载分隔条,返回 { 容器, 事件记录, 当前宽度 } */
  const mount = (initial = 248) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    const events: { dragging: boolean }[] = [];
    let width = initial;
    const widths: number[] = [];

    const handle = createElement(SidebarResizer, {
      width,
      onWidthChange: (next: number) => {
        width = next;
        widths.push(next);
      },
      onDragStateChange: (dragging: boolean) => events.push({ dragging }),
    });

    act(() => root.render(handle));

    const separator = container.querySelector<HTMLElement>("[role='separator']");
    if (!separator) throw new Error("分隔条未渲染");

    return { container, separator, events, widths, get width() { return width; } };
  };

  /** 触发一次完整拖动:mousedown → 若干 mousemove → mouseup */
  const drag = (
    separator: HTMLElement,
    from: number,
    to: number,
  ) => {
    act(() => {
      separator.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: from, clientY: 300, button: 0 }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: to, clientY: 300 }),
      );
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: to, clientY: 300 }));
    });
  };

  it("渲染为分隔条语义,可聚焦(键盘也能调宽度)", () => {
    const { separator } = mount();
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuenow")).toBe("248");
    expect(separator.getAttribute("aria-valuemin")).toBe(String(SIDEBAR_WIDTH_MIN));
    expect(separator.getAttribute("aria-valuemax")).toBe(String(SIDEBAR_WIDTH_MAX));
    expect(separator.getAttribute("tabindex")).toBe("0");
  });

  it("拖动时宽度实时跟随鼠标位移", () => {
    const { separator, widths } = mount(248);
    drag(separator, 248, 348);
    expect(widths).toContain(348);
  });

  it("宽度夹在上下限之间", () => {
    const { separator, widths } = mount(248);
    // 往右拖到极远 → 夹到上限
    drag(separator, 248, 5000);
    expect(widths[widths.length - 1]).toBe(SIDEBAR_WIDTH_MAX);
    // 往左拖到极远 → 夹到下限
    drag(separator, 248, -5000);
    expect(widths[widths.length - 1]).toBe(SIDEBAR_WIDTH_MIN);
  });

  it("拖动开始与结束各通知一次父级", () => {
    const { separator, events } = mount();
    drag(separator, 248, 300);
    expect(events.map((e) => e.dragging)).toEqual([true, false]);
  });

  it("只响应主键,右键不触发拖动", () => {
    const { separator, events } = mount();
    act(() => {
      separator.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 248, clientY: 300, button: 2 }),
      );
    });
    expect(events).toHaveLength(0);
  });

  it("双击回到默认宽度", () => {
    const { separator, widths } = mount(400);
    act(() => {
      separator.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(widths[widths.length - 1]).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("键盘 ←/→ 微调宽度,Shift 加速", () => {
    const { separator, widths } = mount(248);
    act(() => {
      separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(widths[widths.length - 1]).toBe(264);
    act(() => {
      separator.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }),
      );
    });
    expect(widths[widths.length - 1]).toBe(216);
  });

  it("拖动中鼠标移出分隔条也不中断(监听挂在 window 上)", () => {
    const { separator, widths } = mount(248);
    act(() => {
      separator.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 248, clientY: 300, button: 0 }),
      );
    });
    // 鼠标移出分隔条,事件仍派发到 window
    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 400, clientY: 900 }),
      );
    });
    expect(widths[widths.length - 1]).toBe(400);
  });

  it("窗口失焦也能收尾,不会卡在拖动中", () => {
    const { separator, events } = mount();
    act(() => {
      separator.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 248, clientY: 300, button: 0 }),
      );
    });
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(events.map((e) => e.dragging)).toEqual([true, false]);
  });
});
