import { afterEach, describe, expect, it, vi } from "vitest";
import { placeFloatMenu } from "../float-menu";

describe("placeFloatMenu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("底部空间不足时上翻并限制 maxHeight", () => {
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1200);
    const pos = placeFloatMenu(
      { left: 100, right: 140, top: 720, bottom: 750 },
      { estimatedHeight: 400, width: 176 },
    );
    expect(pos.placement).toBe("top");
    expect(pos.maxHeight).toBeLessThanOrEqual(720 - 8);
    expect(pos.y).toBe(716);
  });

  it("下方空间足够时向下展开", () => {
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 1200);
    const pos = placeFloatMenu(
      { left: 100, right: 140, top: 100, bottom: 130 },
      { estimatedHeight: 400, width: 176 },
    );
    expect(pos.placement).toBe("bottom");
    expect(pos.y).toBe(134);
  });
});
