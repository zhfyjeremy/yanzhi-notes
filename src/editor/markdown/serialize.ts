import type { Mark, Node as PMNode } from "@tiptap/pm/model";

/**
 * PM doc → Markdown 序列化器(PRD §12:序列化单路径,双模式共用同一条)。
 *
 * 内置允许的规范化(§4.6):
 * - 块之间统一以空行分隔
 * - 行尾空白剔除;连续空行压缩至多一个;文件末尾单一换行
 *
 * 已知边界(fixtures 锁定,超出的组合 M1 再扩):
 * - ==高亮== 内部不再嵌套强调;<u> 内同
 * - mark 内容首尾空白移到定界符外
 */

const MARK_ORDER = [
  "wikiLink",
  "link",
  "underline",
  "highlight",
  "bold",
  "italic",
  "strike",
  "code",
];

const ESCAPE_RE = /[\\`*_{}[\]()<>#!|~=]/g;

function escapeText(text: string, startOfLine: boolean): string {
  let out = text.replace(ESCAPE_RE, (ch) => `\\${ch}`);
  if (startOfLine) {
    // 行首的列表/分割线形态需要转义;"2.1" 这类非列表数字不转
    if (/^\d{1,9}[.)](\s|$)/.test(text) || /^[.\-](\s|$)/.test(text)) {
      out = `\\${out}`;
    }
  }
  return out;
}

function longestBacktickRun(s: string): number {
  const runs = s.match(/`+/g);
  return runs ? Math.max(...runs.map((r) => r.length)) : 0;
}

function sortMarks(marks: readonly Mark[]): Mark[] {
  return [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name),
  );
}

function wrapMark(mark: Mark, content: string): string {
  switch (mark.type.name) {
    case "bold":
      return `**${content}**`;
    case "italic":
      return `*${content}*`;
    case "strike":
      return `~~${content}~~`;
    case "highlight":
      return `==${content}==`;
    case "underline":
      return `<u>${content}</u>`;
    case "code": {
      const ticks = "`".repeat(longestBacktickRun(content) + 1);
      const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
      return `${ticks}${pad}${content}${pad}${ticks}`;
    }
    case "link": {
      const href = String(mark.attrs.href ?? "");
      const target = /[\s<>()]/.test(href)
        ? `<${href.replace(/>/g, "\\>")}>`
        : href;
      return `[${content}](${target})`;
    }
    case "wikiLink": {
      const target = String(mark.attrs.target ?? "");
      return content === target ? `[[${target}]]` : `[[${target}|${content}]]`;
    }
    default:
      return content;
  }
}

function serializeTextRun(
  text: string,
  marks: readonly Mark[],
  startOfLine = false,
): string {
  const hasCode = marks.some((m) => m.type.name === "code");
  if (hasCode) {
    let body = text;
    for (const mark of sortMarks(marks).reverse()) {
      body = wrapMark(mark, body);
    }
    return body;
  }
  // 纯双链 label 不转义:[[a|b]] 内部按原文返回
  const plainWiki =
    marks.length === 1 && marks[0].type.name === "wikiLink";
  const lead = text.match(/^\s+/)?.[0] ?? "";
  const trail = text.match(/\s+$/)?.[0] ?? "";
  const core = text.slice(lead.length, text.length - trail.length);
  if (core === "") return text;
  let body = plainWiki
    ? core
    : escapeText(core, startOfLine && lead === "");
  for (const mark of sortMarks(marks).reverse()) {
    body = wrapMark(mark, body);
  }
  return lead + body + trail;
}

function imageToMd(node: PMNode): string {
  const alt = String(node.attrs.alt ?? "").replace(/[[\]]/g, "\\$&");
  const rawSrc = String(node.attrs.src ?? "");
  const src = /[\s<>()]/.test(rawSrc)
    ? `<${rawSrc.replace(/>/g, "\\>")}>`
    : rawSrc;
  return `![${alt}](${src})`;
}

class MarkdownSerializer {
  private lines: string[] = [];
  private currentLine = "";
  private prefixStack: string[] = [];

  get value(): string {
    if (this.currentLine !== "") {
      this.lines.push(this.currentLine);
      this.currentLine = "";
    }
    return (
      this.lines
        .join("\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\s*$/, "") + "\n"
    );
  }

  private get prefix(): string {
    return this.prefixStack.join("");
  }

  private write(text: string): void {
    if (text === "") return;
    if (this.currentLine === "") this.currentLine = this.prefix;
    this.currentLine += text;
  }

  private newline(): void {
    this.lines.push(this.currentLine === "" ? this.prefix : this.currentLine);
    this.currentLine = "";
  }

  private blankLine(): void {
    if (this.currentLine !== "") this.newline();
    const last = this.lines[this.lines.length - 1];
    if (
      this.lines.length &&
      last.trimEnd() !== "" &&
      last.trimEnd() !== this.prefix.trimEnd()
    ) {
      // 空行须带 prefix:块引用内输出 ">" 才能延续引用
      this.lines.push(this.prefix);
    }
  }

  renderChildren(node: PMNode, separate: boolean): void {
    node.forEach((child, _offset, index) => {
      if (index > 0 && separate) this.blankLine();
      this.render(child);
    });
  }

  render(node: PMNode): void {
    switch (node.type.name) {
      case "doc":
        this.renderChildren(node, true);
        break;
      case "paragraph":
        this.renderInline(node);
        this.newline();
        break;
      case "heading":
        this.write("#".repeat(Number(node.attrs.level ?? 1)) + " ");
        this.renderInline(node);
        this.newline();
        break;
      case "blockquote":
        this.prefixStack.push("> ");
        this.renderChildren(node, true);
        this.prefixStack.pop();
        break;
      case "bulletList":
        this.renderList(node, () => "- ");
        break;
      case "orderedList":
        this.renderOrderedList(node);
        break;
      case "taskList":
        this.renderList(node, (item) =>
          item.attrs.checked ? "- [x] " : "- [ ] ",
        );
        break;
      case "rawHtml": {
        const content = String(node.attrs.content ?? "").replace(/\n$/, "");
        for (const line of content.split("\n")) {
          this.write(line);
          this.newline();
        }
        break;
      }
      case "codeBlock": {
        // Tiptap 代码块文本常带尾换行,fence 内不应出现空尾行
        const content = node.textContent.replace(/\n+$/, "");
        const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
        const lang = String(node.attrs.language ?? "");
        this.write(fence + lang);
        this.newline();
        for (const line of content.split("\n")) {
          this.write(line);
          this.newline();
        }
        this.write(fence);
        this.newline();
        break;
      }
      case "horizontalRule":
        this.write("---");
        this.newline();
        break;
      case "image":
        this.write(imageToMd(node));
        this.newline();
        break;
      case "table":
        this.renderTable(node);
        break;
      default: {
        // 未知节点:诚实降级为文本(§4.6,禁止静默丢弃)
        console.warn(`[serialize] unhandled node type: ${node.type.name}`);
        this.write(node.textContent);
        this.newline();
        break;
      }
    }
  }

  private renderInline(node: PMNode): void {
    let atLineStart =
      this.currentLine === "" || this.currentLine === this.prefix;
    node.forEach((child) => {
      if (child.isText && child.text != null) {
        this.write(serializeTextRun(child.text, child.marks, atLineStart));
        atLineStart = false;
      } else if (child.type.name === "hardBreak") {
        this.write("\\");
        this.newline();
        atLineStart = true;
      } else if (child.type.name === "image") {
        this.write(imageToMd(child));
        atLineStart = false;
      } else {
        this.write(child.textContent);
        atLineStart = false;
      }
    });
  }

  private renderList(
    node: PMNode,
    markerOf: (item: PMNode) => string,
  ): void {
    node.forEach((item) => {
      this.renderListItem(item, markerOf(item));
    });
  }

  private renderOrderedList(node: PMNode): void {
    let n = Number(node.attrs.start ?? 1);
    node.forEach((item) => {
      this.renderListItem(item, `${n++}. `);
    });
  }

  private renderListItem(item: PMNode, marker: string): void {
    let hasContent = false;
    item.forEach((child, _offset, index) => {
      if (index === 0 && child.type.name === "paragraph") {
        this.currentLine = this.prefix + marker;
        this.renderInline(child);
        this.newline();
        hasContent = true;
      } else if (index === 0) {
        // 首子是块(嵌套列表/代码块等):marker 后接块内容
        this.currentLine = this.prefix + marker.trimEnd() + " ";
        this.render(child);
        if (child.type.name === "paragraph") this.newline();
        hasContent = true;
      } else {
        if (child.type.name === "codeBlock" || child.type.name === "blockquote") {
          this.blankLine();
        }
        this.prefixStack.push(" ".repeat(marker.length));
        this.render(child);
        this.prefixStack.pop();
      }
    });
    if (!hasContent) {
      this.write(marker.trimEnd());
      this.newline();
    }
  }

  private renderTable(node: PMNode): void {
    let headerDone = false;
    let aligns: string[] = [];
    node.forEach((row) => {
      this.write("| ");
      row.forEach((cell) => {
        if (!headerDone && cell.type.name === "tableHeader") {
          const align = cell.attrs.textAlign;
          aligns.push(
            align === "center"
              ? ":---:"
              : align === "right"
                ? "---:"
                : align === "left"
                  ? ":---"
                  : "---",
          );
        }
        this.renderInline(cell.firstChild ?? cell);
        this.write(" | ");
      });
      this.newline();
      if (!headerDone) {
        this.write("| ");
        for (const a of aligns) this.write(`${a} | `);
        this.newline();
        headerDone = true;
      }
    });
  }
}

/** PM doc → Markdown(两种编辑模式共用的唯一序列化路径) */
export function docToMarkdown(doc: PMNode): string {
  const serializer = new MarkdownSerializer();
  serializer.renderChildren(doc, true);
  return serializer.value;
}
