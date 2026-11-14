/**
 * PM doc → Pandoc JSON AST(DOCX 导出唯一语义入口)。
 * Pandoc 只负责 AST → DOCX;这里必须解释全部砚知节点,未知内容显式 warning,
 * 不回退到 Markdown 二次解析。
 */
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import type { PandocAlignment, PandocAttr, PandocBlock, PandocColWidth, PandocDocument, PandocInline, PandocRow, PandocTableCell, PandocTableBody } from "./pandoc-types";

export type ExportWarningKind =
  | "unknown-node"
  | "unknown-mark"
  | "wiki-link"
  | "mermaid"
  | "resource"
  | "inline-image";

export interface ExportWarning {
  kind: ExportWarningKind;
  message: string;
}

export interface DocxExportStats {
  localImages: number;
  remoteImages: number;
  mermaidRendered: number;
  mermaidFailed: number;
  callouts: number;
  details: number;
  rawHtmlBlocks: number;
}

export interface PandocExportOptions {
  tags?: string[];
  /** wikiLink target → 可供 Word 打开的 Markdown 文件路径;null = 无法解析 */
  resolveWikiTarget?: (target: string) => string | null;
  /** assets 链接 → 本机绝对路径;null = 保持相对路径交给 Pandoc resource-path */
  resolveAssetPath?: (href: string) => string | null;
  /** Mermaid 源码 → data:image/svg+xml;base64,...;null/异常 = 降级源码 */
  renderMermaid?: (code: string) => Promise<string | null>;
  /** ask 前由 App 已确认;link = 不嵌入,转换为普通链接 */
  remoteImages: "embed" | "link";
}

const ATTR: PandocAttr = ["", [], []];
const MARK_ORDER = [
  "wikiLink",
  "link",
  "fontColor",
  "underline",
  "highlight",
  "bold",
  "italic",
  "strike",
  "code",
];
const CALLOUT_LABEL: Record<string, string> = {
  info: "信息",
  success: "成功",
  warning: "警告",
  caution: "注意",
};
const CALLOUT_STYLE_ID: Record<string, string> = {
  info: "YanzhiCalloutInfo",
  success: "YanzhiCalloutSuccess",
  warning: "YanzhiCalloutWarning",
  caution: "YanzhiCalloutCaution",
};

const str = (text: string): PandocInline[] =>
  text ? [{ t: "Str", c: text }] : [];

/** Pandoc 的 OMML 转换器不接受环境外的 `\\` / 多行公式;包进 gathered 保持换行语义。 */
function displayMathForPandoc(raw: string): string {
  const latex = raw.trim();
  if (!latex || (!latex.includes("\\\\") && !latex.includes("\n"))) return latex;
  if (/^\\begin\{(?:aligned|gathered|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}/.test(latex)) {
    return latex;
  }
  return `\\begin{gathered}${latex}\\end{gathered}`;
}

const textInlines = (text: string): PandocInline[] => {
  // PM text node 保留原始空白;Pandoc Str 可包含空格,但拆成 Space 更贴近原生 AST。
  const out: PandocInline[] = [];
  let buffer = "";
  for (const ch of text) {
    if (ch === " " || ch === "\u00a0") {
      if (buffer) {
        out.push({ t: "Str", c: buffer });
        buffer = "";
      }
      out.push({ t: "Space" });
    } else if (ch === "\n") {
      if (buffer) {
        out.push({ t: "Str", c: buffer });
        buffer = "";
      }
      out.push({ t: "SoftBreak" });
    } else {
      buffer += ch;
    }
  }
  if (buffer) out.push({ t: "Str", c: buffer });
  return out;
};

const sortedMarks = (marks: readonly Mark[]): Mark[] =>
  [...marks].sort(
    (a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name),
  );

function normalizeColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const value = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return value.toUpperCase();
  }
  const named: Record<string, string> = {
    black: "000000", white: "FFFFFF", red: "FF0000", orange: "FFA500", yellow: "FFFF00",
    green: "008000", cyan: "00FFFF", blue: "0000FF", purple: "800080", gray: "808080", grey: "808080",
  };
  if (named[text]) return named[text];
  const rgb = text.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((n) =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0").toUpperCase(),
    );
    return channels.join("");
  }
  return null;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 任意色值用受控 OpenXML run 保留;链接由外层 Pandoc Link 继续提供 relationship。 */
function coloredRawInline(
  text: string,
  marks: readonly Mark[],
): PandocInline | null {
  const colorMark = marks.find((m) => m.type.name === "fontColor");
  const color = normalizeColor(String(colorMark?.attrs.color ?? ""));
  if (!color) return null;
  const props =
    '<w:rPr>' +
    '<w:color w:val="' + color + '"/>' +
    (marks.some((m) => m.type.name === "bold") ? "<w:b/>" : "") +
    (marks.some((m) => m.type.name === "italic") ? "<w:i/>" : "") +
    (marks.some((m) => m.type.name === "strike") ? "<w:strike/>" : "") +
    (marks.some((m) => m.type.name === "underline") ? '<w:u w:val="single"/>' : "") +
    (marks.some((m) => m.type.name === "highlight") ? '<w:highlight w:val="yellow"/>' : "") +
    (marks.some((m) => m.type.name === "code") ? '<w:rStyle w:val="VerbatimChar"/>' : "") +
    "</w:rPr>";
  return {
    t: "RawInline",
    c: [
      "openxml",
      `<w:r>${props}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`,
    ],
  };
}

function wrapInline(
  inline: PandocInline[],
  mark: Mark,
  warnings: ExportWarning[],
  resolveWikiTarget: ((target: string) => string | null) | undefined,
): PandocInline[] {
  switch (mark.type.name) {
    case "bold":
      return [{ t: "Strong", c: inline }];
    case "italic":
      return [{ t: "Emph", c: inline }];
    case "strike":
      return [{ t: "Strikeout", c: inline }];
    case "underline":
      return [{ t: "Underline", c: inline }];
    case "highlight":
      return [{ t: "Span", c: [["", ["mark"], []], inline] }];
    case "fontColor":
      // coloredRawInline 已在入口处理;嵌套其它 inline 时保持外层不重复。
      return inline;
    case "code": {
      // Code mark 的内容已在 text → Code 转换中保留;这里不能重建空 Code,
      // 否则 DOCX 中会只剩夹在代码之间的普通文本(如 `a`===>`b` 只剩 ===>).
      const text = inline
        .map((item) => {
          if (item.t === "Code") return String(item.c[1] ?? "");
          if (item.t === "Str") return item.c;
          if (item.t === "Space") return " ";
          if (item.t === "SoftBreak") return "\n";
          return "";
        })
        .join("");
      return [{ t: "Code", c: [ATTR, text] }];
    }
    case "link": {
      const href = String(mark.attrs.href ?? "");
      const title = String(mark.attrs.title ?? "");
      return [{ t: "Link", c: [ATTR, inline, [href, title]] }];
    }
    case "wikiLink": {
      const target = String(mark.attrs.target ?? "").trim();
      if (!target) {
        warnings.push({ kind: "wiki-link", message: "存在空双链目标，已导出为普通文本" });
        return inline;
      }
      const path = resolveWikiTarget?.(target);
      if (!path) {
        warnings.push({ kind: "wiki-link", message: `双链「${target}」未解析到文档，已保留显示文本与目标` });
        return [{ t: "Span", c: [["", ["yanzhi-wiki-link"], [["target", target]]], inline] }];
      }
      return [{ t: "Link", c: [["", ["yanzhi-wiki-link"], []], inline, [path, "砚知双链"]] }];
    }
    default:
      if (!warnings.some((w) => w.kind === "unknown-mark" && w.message.includes(mark.type.name))) {
        warnings.push({ kind: "unknown-mark", message: `未知行内格式 ${mark.type.name} 已按普通文本导出` });
      }
      return inline;
  }
}

class Converter {
  private readonly warnings: ExportWarning[] = [];
  private readonly stats: DocxExportStats = {
    localImages: 0,
    remoteImages: 0,
    mermaidRendered: 0,
    mermaidFailed: 0,
    callouts: 0,
    details: 0,
    rawHtmlBlocks: 0,
  };

  constructor(private readonly opts: PandocExportOptions) {}

  private warnOnce(warning: ExportWarning) {
    this.warnings.push(warning);
  }

  async convert(node: PMNode): Promise<PandocDocument> {
    const blocks = await this.convertBlocks(node);
    const meta: Record<string, unknown> = {};
    // 注意: Pandoc 的 title metadata 会渲染成文档顶部 Title 段落。
    // 砚知导出以正文为准,文件名只用于保存对话框,不额外插入标题。
    if (this.opts.tags?.length) {
      meta.keywords = {
        t: "MetaList",
        c: this.opts.tags.map((tag) => ({ t: "MetaInlines", c: str(tag) })),
      };
    }
    return {
      // Pandoc 3.x 兼容的稳定 API 版本;JSON reader 接受旧版结构。
      "pandoc-api-version": [1, 23, 1, 2],
      meta,
      blocks,
    };
  }

  get report() {
    return { warnings: this.warnings, stats: this.stats };
  }

  private async convertBlocks(node: PMNode): Promise<PandocBlock[]> {
    const out: PandocBlock[] = [];
    for (let i = 0; i < node.childCount; i++) {
      for (const block of await this.convertBlock(node.child(i))) out.push(...block);
    }
    return out;
  }

  private async convertBlock(node: PMNode): Promise<PandocBlock[][]> {
    switch (node.type.name) {
      case "doc":
      case "cell":
      case "header":
      case "row":
      case "listItem":
      case "taskItem":
        return [await this.convertBlocks(node)];
      case "paragraph":
        if (node.childCount === 1 && node.child(0).type.name === "image") {
          return await this.convertStandaloneImage(node.child(0));
        }
        return [[{ t: "Para", c: await this.convertInlines(node) }]];
      case "heading": {
        const level = Math.max(1, Math.min(6, Number(node.attrs.level ?? 1)));
        return [[{ t: "Header", c: [level, ATTR, await this.convertInlines(node)] }]];
      }
      case "bulletList":
        return [[{ t: "BulletList", c: await this.convertListItems(node) }]];
      case "orderedList": {
        const items = await this.convertListItems(node);
        return [[{
          t: "OrderedList",
          c: [[Number(node.attrs.start ?? 1) || 1, { t: "Decimal" }, { t: "Period" }], items],
        }]];
      }
      case "taskList": {
        const items: PandocBlock[][] = [];
        for (let i = 0; i < node.childCount; i++) {
          const item = node.child(i);
          const children = await this.convertBlocks(item);
          const status = item.attrs.checked ? "☒" : "☐";
          if (children[0]?.t === "Plain" || children[0]?.t === "Para") {
            children[0] = {
              t: "Plain",
              c: [{ t: "Str", c: status }, { t: "Space" }, ...children[0].c],
            } satisfies PandocBlock;
          } else {
            children.unshift({ t: "Plain", c: [{ t: "Str", c: status }, { t: "Space" }] });
          }
          items.push(children);
        }
        return [[{ t: "BulletList", c: items }]];
      }
      case "blockquote":
        return [[{ t: "BlockQuote", c: await this.convertBlocks(node) }]];
      case "horizontalRule":
        return [[{ t: "HorizontalRule" }]];
      case "codeBlock":
        return await this.convertCodeBlock(node);
      case "mathBlock":
        return [[{ t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, displayMathForPandoc(String(node.attrs.latex ?? ""))] }] }]];
      case "image":
        return await this.convertStandaloneImage(node);
      case "attachment":
        return await this.convertAttachment(node);
      case "rawHtml": {
        this.stats.rawHtmlBlocks++;
        return [[{
          t: "CodeBlock",
          c: [["", ["html"], []], String(node.attrs.content ?? "")],
        }]];
      }
      case "callout":
        return await this.convertCallout(node);
      case "details":
        return await this.convertDetails(node);
      case "table":
        return [await this.convertTable(node)];
      case "text":
        // Markdown 解析边界下 text 不应直接成为块;保留为 Plain 防止静默丢。
        return [[{ t: "Plain", c: await this.convertInlines(node) }]];
      default: {
        this.warnOnce({ kind: "unknown-node", message: `未知内容块 ${node.type.name}，已尝试按普通段落导出` });
        const children: PandocBlock[] = await this.convertBlocks(node);
        return [children.length ? children : [{ t: "Para", c: [] }]];
      }
    }
  }

  private async convertListItems(node: PMNode): Promise<PandocBlock[][]> {
    const items: PandocBlock[][] = [];
    for (let i = 0; i < node.childCount; i++) {
      let blocks = await this.convertBlocks(node.child(i));
      // Pandoc 列表项第一段通常用 Plain,避免普通列表项额外撑开。
      if (blocks[0]?.t === "Para") blocks[0] = { t: "Plain", c: blocks[0].c };
      items.push(blocks);
    }
    return items;
  }

  private async convertCodeBlock(node: PMNode): Promise<PandocBlock[][]> {
    const language = String(node.attrs.language ?? "");
    const code = node.textContent.replace(/\n+$/, "");
    if (language !== "mermaid") {
      return [[{ t: "CodeBlock", c: [["", language ? [language] : [], []], code] }]];
    }
    if (!code.trim()) return [[{ t: "CodeBlock", c: [["", ["mermaid"], []], code] }]];
    const rendered = await this.opts.renderMermaid?.(code).catch(() => null) ?? null;
    if (!rendered) {
      this.stats.mermaidFailed++;
      this.warnOnce({ kind: "mermaid", message: "Mermaid 图渲染失败，已保留源码" });
      return [[{ t: "CodeBlock", c: [["", ["mermaid"], []], code] }]];
    }
    this.stats.mermaidRendered++;
    return [[{ t: "Para", c: [{ t: "Image", c: [ATTR, str("Mermaid 图"), [rendered, "Mermaid"]] }] }]];
  }

  private async convertStandaloneImage(node: PMNode): Promise<PandocBlock[][]> {
    const inline = await this.convertImage(node);
    if (inline?.t !== "Image") return inline ? [[{ t: "Plain", c: [inline] }]] : [];
    const attrs: [string, string][] = [];
    const width = String(node.attrs.width ?? "");
    if (width) attrs.push(["width", width]);
    inline.c[0] = ["", ["yanzhi-image"], attrs];
    if (node.attrs.align === "center") {
      const attr: PandocAttr = ["", [], [["custom-style", "YanzhiImageCenter"]]];
      return [[{ t: "Div", c: [attr, [{ t: "Plain", c: [inline] }]] }]];
    }
    return [[{ t: "Plain", c: [inline] }]];
  }

  private async convertImage(node: PMNode): Promise<PandocInline | null> {
    const src = String(node.attrs.src ?? "");
    if (!src) {
      this.warnOnce({ kind: "resource", message: "存在空图片地址，已跳过" });
      return null;
    }
    const alt = str(String(node.attrs.alt ?? ""));
    const title = String(node.attrs.title ?? "");
    if (/^https?:\/\//i.test(src)) {
      this.stats.remoteImages++;
      if (this.opts.remoteImages === "link") {
        return { t: "Link", c: [ATTR, alt.length ? alt : str(src), [src, "外链图片"]] };
      }
      return { t: "Image", c: [ATTR, alt, [src, title]] };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("/")) {
      this.warnOnce({
        kind: "resource",
        message: `图片地址不支持嵌入,已导出为链接:${src}`,
      });
      return { t: "Link", c: [ATTR, alt.length ? alt : str(src), [src, title || "图片"]] };
    }
    this.stats.localImages++;
    const resolved = this.opts.resolveAssetPath?.(src);
    if (resolved === "") {
      this.warnOnce({
        kind: "resource",
        message: `本地图片不在 assets 目录内,已导出为链接:${src}`,
      });
      return { t: "Link", c: [ATTR, alt.length ? alt : str(src), [src, title || "本地图片"]] };
    }
    return { t: "Image", c: [ATTR, alt, [resolved ?? src, title]] };
  }

  private async convertAttachment(node: PMNode): Promise<PandocBlock[][]> {
    const href = String(node.attrs.href ?? "");
    const name = String(node.attrs.name ?? "");
    const target = this.opts.resolveAssetPath?.(href) ?? href;
    return [[{ t: "Para", c: [{ t: "Link", c: [ATTR, str(name || href), [target, "砚知附件"]] }] }]];
  }

  private async convertCallout(node: PMNode): Promise<PandocBlock[][]> {
    this.stats.callouts++;
    const type = String(node.attrs.type ?? "info");
    const label = CALLOUT_LABEL[type] ?? "信息";
    const title = String(node.attrs.title ?? "");
    const headingText = title ? `${label} · ${title}` : label;
    const styleId = CALLOUT_STYLE_ID[type] ?? CALLOUT_STYLE_ID.info;
    const titleAttr: PandocAttr = ["", [], [["custom-style", `${styleId}Title`]]];
    const bodyAttr: PandocAttr = ["", [], [["custom-style", styleId]]];
    const titleDiv: PandocBlock = {
      t: "Div",
      c: [titleAttr, [{ t: "Para", c: str(headingText) }]],
    };
    const bodyDiv: PandocBlock = {
      t: "Div",
      c: [bodyAttr, await this.convertBlocks(node)],
    };
    return [[titleDiv, bodyDiv]];
  }

  private async convertDetails(node: PMNode): Promise<PandocBlock[][]> {
    this.stats.details++;
    const titleAttr: PandocAttr = ["", [], [["custom-style", "YanzhiDetailsTitle"]]];
    const bodyAttr: PandocAttr = ["", [], [["custom-style", "YanzhiDetailsBody"]]];
    const summary: PandocBlock = {
      t: "Div",
      c: [titleAttr, [{ t: "Para", c: str(String(node.attrs.summary ?? "摘要")) }]],
    };
    const body: PandocBlock = {
      t: "Div",
      c: [bodyAttr, await this.convertBlocks(node)],
    };
    return [[summary, body]];
  }

  private async convertTable(node: PMNode): Promise<PandocBlock[]> {
    const rows = Array.from({ length: node.childCount }, (_, i) => node.child(i));
    const headerRow = rows.find((row) => row.child(0)?.type.name === "tableHeader");
    const bodyRows = rows.filter((row) => row !== headerRow);
    const columnCount = Math.max(0, ...rows.map((row) => row.childCount));
    const colAlignments = Array.from({ length: columnCount }, (_, col) => {
      const source = headerRow?.child(col) ?? bodyRows[0]?.child(col);
      const align = String(source?.attrs.textAlign ?? "");
      if (align === "left") return { t: "AlignLeft" } as const;
      if (align === "center") return { t: "AlignCenter" } as const;
      if (align === "right") return { t: "AlignRight" } as const;
      return { t: "AlignDefault" } as const;
    });
    const rawWidths = Array.isArray(node.attrs.colwidth) ? node.attrs.colwidth : [];
    const numericWidths = rawWidths.filter((w): w is number => typeof w === "number" && w > 0);
    const total = numericWidths.reduce((sum, w) => sum + w, 0);
    const colSpecs = Array.from({ length: columnCount }, (_, i) => {
      const value = Number(rawWidths[i] ?? 0);
      const width = numericWidths.length === columnCount && total > 0 && value > 0
        ? ({ t: "ColWidth" as const, c: value / total } satisfies PandocColWidth)
        : ({ t: "ColWidthDefault" as const } satisfies PandocColWidth);
      const spec: [PandocAlignment, PandocColWidth] = [
        colAlignments[i] ?? { t: "AlignDefault" },
        width,
      ];
      return spec;
    });

    const toRow = async (row: PMNode): Promise<PandocRow> => {
      const cells: PandocTableCell[] = [];
      for (let i = 0; i < row.childCount; i++) {
        const cell = row.child(i);
        cells.push([
          ATTR,
          colAlignments[i] ?? { t: "AlignDefault" },
          1,
          1,
          await this.convertBlocks(cell),
        ]);
      }
      return [ATTR, cells];
    };
    const head: PandocRow[] = headerRow ? [await toRow(headerRow)] : [];
    const bodies: PandocTableBody[] = bodyRows.length
      ? [[ATTR, 0, [], await Promise.all(bodyRows.map(toRow))]]
      : [];
    return [{
      t: "Table",
      c: [
        ATTR,
        [null, []],
        colSpecs,
        [ATTR, head],
        bodies,
        [ATTR, []],
      ],
    }];
  }

  private async convertInlines(node: PMNode): Promise<PandocInline[]> {
    const out: PandocInline[] = [];
    for (let i = 0; i < node.childCount; i++) {
      out.push(...await this.convertInline(node.child(i)));
    }
    return out;
  }

  private async convertInline(node: PMNode): Promise<PandocInline[]> {
    switch (node.type.name) {
      case "text": {
        const text = node.text ?? "";
        const colorMark = node.marks.find((m) => m.type.name === "fontColor");
        const color = colorMark ? normalizeColor(String(colorMark.attrs.color ?? "")) : null;
        const hasCode = node.marks.some((m) => m.type.name === "code");
        let output: PandocInline[] = hasCode
          ? [{ t: "Code", c: [ATTR, text] }]
          : textInlines(text);
        if (colorMark && !color) {
          this.warnOnce({
            kind: "resource",
            message: `文字颜色值无法导出,已按正文色处理:${String(colorMark.attrs.color ?? "")}`,
          });
        }
        if (color) {
          const raw = coloredRawInline(text, node.marks);
          if (raw) {
            // OpenXML run 已携带颜色、空白与常见行内格式;Link/WikiLink 仍由 Pandoc 外层构造。
            let wrapped: PandocInline[] = [raw];
            for (const mark of sortedMarks(node.marks).reverse()) {
              if (mark.type.name === "link" || mark.type.name === "wikiLink") {
                wrapped = wrapInline(wrapped, mark, this.warnings, this.opts.resolveWikiTarget);
              }
            }
            return wrapped;
          }
        }
        for (const mark of sortedMarks(node.marks).reverse()) {
          output = wrapInline(output, mark, this.warnings, this.opts.resolveWikiTarget);
        }
        return output;
      }
      case "hardBreak":
        return [{ t: "LineBreak" }];
      case "image": {
        const image = await this.convertImage(node);
        return image ? [image] : [];
      }
      case "mathInline":
        return [{ t: "Math", c: [{ t: "InlineMath" }, String(node.attrs.latex ?? "")] }];
      default: {
        this.warnOnce({ kind: "inline-image", message: `未知行内内容 ${node.type.name}，已按文本导出` });
        return node.isLeaf ? [] : await this.convertInlines(node);
      }
    }
  }
}

export async function pmDocToPandocAst(
  doc: PMNode,
  options: PandocExportOptions,
): Promise<{ ast: PandocDocument; warnings: ExportWarning[]; stats: DocxExportStats }> {
  const converter = new Converter(options);
  const ast = await converter.convert(doc);
  return { ast, ...converter.report };
}
