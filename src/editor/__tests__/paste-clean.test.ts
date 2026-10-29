import { describe, expect, it } from "vitest";
import { DOMParser } from "@tiptap/pm/model";
import { cleanPastedHtml } from "../paste-clean";
import { getSchema } from "../markdown/schema";

/**
 * 粘贴清洗(PRD §5.7):HTML 清洗断言 + 清洗产物过 schema DOMParser 的端到端结构断言。
 */

const schema = getSchema();

/** 清洗后 HTML → PM doc → JSON 节点签名(type 列表),验证能被 schema 正确消化 */
function parseCleaned(html: string) {
  const cleaned = cleanPastedHtml(html);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = cleaned;
  return {
    cleaned,
    types: (() => {
      const names: string[] = [];
      const walk = (node: { type: { name: string }; forEach: Function }) => {
        node.forEach((child: any) => {
          names.push(child.type.name);
          walk(child);
        });
      };
      const doc = DOMParser.fromSchema(schema).parse(wrapper);
      walk(doc as any);
      return names;
    })(),
  };
}

describe("cleanPastedHtml:样式与脚本", () => {
  it("字体字号颜色样式丢弃,文字保留", () => {
    const out = cleanPastedHtml(
      `<p style="font-size:14px;color:red;margin:0"><span style="color:#333">微信</span>正文</p>`,
    );
    expect(out).not.toContain("style");
    expect(out).not.toContain("span");
    expect(out).toContain("微信正文");
  });

  it("script/style 标签删除", () => {
    const out = cleanPastedHtml(
      `<p>a</p><script>alert(1)</script><style>.x{}</style><p>b</p>`,
    );
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("Word 私有 XML 删除,正文保留", () => {
    const out = cleanPastedHtml(
      `<p class="MsoNormal" style="mso-ansi-language:ZH-CN">导语<o:p></o:p></p>`,
    );
    expect(out).not.toContain("o:p");
    expect(out).not.toContain("MsoNormal");
    expect(out).toContain("导语");
  });

  it("nbsp 归一为普通空格", () => {
    const out = cleanPastedHtml(`<p>微&nbsp;&nbsp;信</p>`);
    expect(out).not.toContain(" ");
    expect(out).toContain("微  信");
  });
});

describe("cleanPastedHtml:链接与图片", () => {
  it("utm_* 与微信追踪参数剥离", () => {
    const out = cleanPastedHtml(
      `<a href="https://example.com/a?utm_source=x&amp;spm=1&amp;id=9">链接</a>`,
    );
    expect(out).toContain("https://example.com/a?id=9");
    expect(out).not.toContain("utm_");
    expect(out).not.toContain("spm=");
  });

  it("javascript: 协议 href 摘除", () => {
    const out = cleanPastedHtml(`<a href="javascript:alert(1)">点我</a>`);
    expect(out).not.toContain("javascript");
    expect(out).toContain("点我");
  });

  it("http 图片保留,data:/blob: 图片删除(禁 base64,落盘 M3)", () => {
    const out = cleanPastedHtml(
      `<p><img src="https://e.com/a.png" alt="图"><img src="data:image/png;base64,xxx"><img src="blob:xx"></p>`,
    );
    expect(out).toContain("https://e.com/a.png");
    expect(out).not.toContain("base64");
    expect(out).not.toContain("blob:");
  });
});

describe("cleanPastedHtml:表格", () => {
  it("合并单元格表格降级为制表符分隔纯文本", () => {
    const out = cleanPastedHtml(
      `<table><tr><th colspan="2">表头</th></tr><tr><td>a</td><td>b</td></tr></table>`,
    );
    expect(out).not.toContain("table");
    // 表头行被 colspan 合并成单格,无 \t;体行两格以 \t 分隔
    expect(out).toContain("表头");
    expect(out).toContain("a\tb");
  });

  it("简单矩形表格保留,能过 schema 解析", () => {
    const r = parseCleaned(
      `<table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table>`,
    );
    expect(r.types).toContain("table");
    expect(r.types).toContain("tableHeader");
    expect(r.types).toContain("tableCell");
  });
});

describe("cleanPastedHtml:列表与代码块", () => {
  it("外部任务列表转 taskList/taskItem,勾选状态保留", () => {
    const r = parseCleaned(
      `<ul><li><input type="checkbox" checked>a</li><li><input type="checkbox">b</li></ul>`,
    );
    expect(r.types).toContain("taskList");
    expect(r.types).toContain("taskItem");
    expect(r.types).not.toContain("bulletList");
    const doc = DOMParser.fromSchema(schema).parse(
      Object.assign(document.createElement("div"), {
        innerHTML: r.cleaned,
      }),
    );
    const checked = doc.toJSON().content[0].content.map(
      (li: any) => li.attrs.checked,
    );
    expect(checked).toEqual([true, false]);
  });

  it("混合列表(部分带 checkbox)保持普通列表", () => {
    const r = parseCleaned(
      `<ul><li><input type="checkbox" checked>a</li><li>普通项</li></ul>`,
    );
    expect(r.types).toContain("bulletList");
    expect(r.types).not.toContain("taskList");
  });

  it("普通有序/无序列表保留", () => {
    const r = parseCleaned(
      `<ol><li>一</li></ol><ul><li>甲</li></ul>`,
    );
    expect(r.types).toContain("orderedList");
    expect(r.types).toContain("bulletList");
  });

  it("代码块保留 language-* class,语言进 codeBlock 节点", () => {
    const r = parseCleaned(
      `<pre><code class="language-typescript hljs">const a = 1</code></pre>`,
    );
    expect(r.cleaned).toContain("language-typescript");
    expect(r.cleaned).not.toContain("hljs");
    expect(r.types).toContain("codeBlock");
  });
});

describe("cleanPastedHtml:文字颜色吸附(§5.7)", () => {
  it("span[style=color] 吸附到最近预设色并转为 font(微信绿偏青 → 青)", () => {
    const out = cleanPastedHtml(
      `<p><span style="color:#07c160">微信绿</span></p>`,
    );
    expect(out).toContain(`<font color="#29a8ab">微信绿</font>`);
    expect(out).not.toContain("span");
  });

  it("font[color] CSS 命名色归一到最近预设色", () => {
    const out = cleanPastedHtml(`<p><font color="red">红</font></p>`);
    expect(out).toContain(`<font color="#e05c5c">红</font>`);
  });

  it("黑白灰(正文色)摘除,不吸附", () => {
    const out = cleanPastedHtml(
      `<p><span style="color: rgb(51, 51, 51)">深灰</span>和<span style="color:#000000">黑</span></p>`,
    );
    expect(out).not.toContain("font");
    expect(out).not.toContain("span");
    expect(out).toContain("深灰和黑");
  });

  it("无 color 的 style(仅字号等)不产生 font", () => {
    const out = cleanPastedHtml(
      `<p><span style="font-size:14px">字</span></p>`,
    );
    expect(out).not.toContain("font");
    expect(out).toContain("字");
  });

  it("非法色值摘除 color,文字保留", () => {
    const out = cleanPastedHtml(`<p><font color="notacolor">字</font></p>`);
    expect(out).not.toContain("color");
    expect(out).toContain("字");
  });

  it("颜色 mark 进 schema(粘贴后可序列化为方言)", () => {
    const cleaned = cleanPastedHtml(
      `<p><span style="color:#07c160">微信绿</span></p>`,
    );
    const wrapper = document.createElement("div");
    wrapper.innerHTML = cleaned;
    const doc = DOMParser.fromSchema(schema).parse(wrapper);
    const marks: string[] = [];
    doc.descendants((node) => {
      if (node.isText) marks.push(...node.marks.map((m) => m.type.name));
    });
    expect(marks).toContain("fontColor");
  });
});
