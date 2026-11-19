import { describe, expect, it } from "vitest";
import {
  buildDecodedTextMap,
  normalizeText,
  normalizedTextOf,
  sourceOffsetForElement,
  sourceOffsetForHit,
} from "../extensions/raw-html-source-map";

describe("HTML 源码位置映射", () => {
  it("跳过标签与注释,只留可见文本", () => {
    const source = '<p align="center">\n  <b>标题</b>\n</p>';
    const { text } = buildDecodedTextMap(source);
    expect(text).toBe("标题");
  });

  it("解码实体并保留原文下标", () => {
    const source = "<p>A&amp;B</p>";
    const map = buildDecodedTextMap(source);
    expect(map.text).toBe("A&B");
    // "A" 在源码里的下标
    expect(source[map.map[0]]).toBe("A");
    // "&"(实体解码而来)指回实体起点
    expect(source[map.map[1]]).toBe("&");
  });

  it("script/style 内容不进文本", () => {
    const source = "<p>前</p><script>var x=1</script><p>后</p>";
    expect(buildDecodedTextMap(source).text).toBe("前后");
  });

  it("连续空白折叠成单个空格", () => {
    expect(buildDecodedTextMap("<p>a   \n  b</p>").text).toBe("a b");
    expect(normalizeText("a   \n  b").text).toBe("a b");
  });

  it("源码与 DOM 的规范化文本一致", () => {
    const source = '<div align="center">\n  <h1>许昌烟草 · 移动端管理后台</h1>\n</div>';
    const div = document.createElement("div");
    div.innerHTML = "<h1>许昌烟草 · 移动端管理后台</h1>";
    expect(normalizedTextOf(div).text).toBe(buildDecodedTextMap(source).text);
  });

  it("命中文字节点 → 源码字符下标(同名文本按出现次序消歧)", () => {
    const source = "<p>repeat</p><p>repeat</p>";
    const div = document.createElement("div");
    div.innerHTML = "<p>repeat</p><p>repeat</p>";
    const frameText = normalizedTextOf(div);
    const second = frameText.ranges[1];
    expect(second).toBeDefined();
    const offset = sourceOffsetForHit(
      source,
      buildDecodedTextMap(source),
      frameText,
      { node: second!.node, offset: 0, element: second!.node.parentElement },
    );
    expect(offset).not.toBeNull();
    // 第二个 repeat 的起点(不是第一个)
    expect(source.slice(offset!, offset! + 6)).toBe("repeat");
    expect(offset!).toBeGreaterThan(source.indexOf("repeat"));
  });

  it("命中文字节点 → 偏移按节点内位置换算", () => {
    const source = "<h1>移动端管理后台</h1>";
    const div = document.createElement("div");
    div.innerHTML = "<h1>移动端管理后台</h1>";
    const frameText = normalizedTextOf(div);
    const range = frameText.ranges[0];
    const offset = sourceOffsetForHit(
      source,
      buildDecodedTextMap(source),
      frameText,
      { node: range!.node, offset: 3, element: range!.node.parentElement },
    );
    expect(offset).not.toBeNull();
    // 节点内偏移 3 = 光标落在第 4 个字符「管」之前
    expect(source[offset!]).toBe("管");
  });

  it("命中元素(无文本)→ 按标签序号粗定位", () => {
    const source = '<p><img src="a.png"></p><p><img src="b.png"></p>';
    const div = document.createElement("div");
    div.innerHTML = '<p><img src="a.png"></p><p><img src="b.png"></p>';
    const imgs = div.getElementsByTagName("img");
    const offset = sourceOffsetForElement(source, imgs[1]);
    expect(offset).not.toBeNull();
    expect(source.slice(offset!)).toContain("b.png");
  });
});
