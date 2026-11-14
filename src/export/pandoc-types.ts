/** Pandoc JSON AST 的最小类型面(仅覆盖砚知 DOCX 导出需要的构造子)。 */

export type PandocAttr = [id: string, classes: string[], kvs: [string, string][]];
export type PandocMathType = { t: "DisplayMath" } | { t: "InlineMath" };
export type PandocAlignment =
  | { t: "AlignDefault" }
  | { t: "AlignLeft" }
  | { t: "AlignCenter" }
  | { t: "AlignRight" };
export type PandocColWidth = { t: "ColWidthDefault" } | { t: "ColWidth"; c: number };

export interface PandocMath {
  t: "Math";
  c: [PandocMathType, string];
}
export interface PandocSpace {
  t: "Space";
}
export interface PandocSoftBreak {
  t: "SoftBreak";
}
export interface PandocLineBreak {
  t: "LineBreak";
}
export interface PandocStr {
  t: "Str";
  c: string;
}
export interface PandocRawInline {
  t: "RawInline";
  c: [format: string, content: string];
}
export interface PandocCode {
  t: "Code";
  c: [PandocAttr, string];
}
export interface PandocEmph {
  t: "Emph";
  c: PandocInline[];
}
export interface PandocUnderline {
  t: "Underline";
  c: PandocInline[];
}
export interface PandocStrong {
  t: "Strong";
  c: PandocInline[];
}
export interface PandocStrikeout {
  t: "Strikeout";
  c: PandocInline[];
}
export interface PandocSpan {
  t: "Span";
  c: [PandocAttr, PandocInline[]];
}
export interface PandocLink {
  t: "Link";
  c: [PandocAttr, PandocInline[], [url: string, title: string]];
}
export interface PandocImage {
  t: "Image";
  c: [PandocAttr, PandocInline[], [url: string, title: string]];
}

export type PandocInline =
  | PandocStr
  | PandocSpace
  | PandocSoftBreak
  | PandocLineBreak
  | PandocEmph
  | PandocUnderline
  | PandocStrong
  | PandocStrikeout
  | PandocSpan
  | PandocCode
  | PandocLink
  | PandocImage
  | PandocMath
  | PandocRawInline;

export interface PandocPara {
  t: "Para";
  c: PandocInline[];
}
export interface PandocPlain {
  t: "Plain";
  c: PandocInline[];
}
export interface PandocHeader {
  t: "Header";
  c: [level: number, PandocAttr, PandocInline[]];
}
export interface PandocBlockQuote {
  t: "BlockQuote";
  c: PandocBlock[];
}
export interface PandocCodeBlock {
  t: "CodeBlock";
  c: [PandocAttr, string];
}
export interface PandocBulletList {
  t: "BulletList";
  c: PandocBlock[][];
}
export type PandocOrderedListAttr = [start: number, style: { t: "Decimal" }, delimiter: { t: "Period" }];
export interface PandocOrderedList {
  t: "OrderedList";
  c: [PandocOrderedListAttr, PandocBlock[][]];
}
export interface PandocHorizontalRule {
  t: "HorizontalRule";
}
export interface PandocDiv {
  t: "Div";
  c: [PandocAttr, PandocBlock[]];
}
export type PandocRow = [attr: PandocAttr, cells: PandocTableCell[]];
export type PandocTableBody = [attr: PandocAttr, rowHeadColumns: number, rowHeads: PandocRow[], rows: PandocRow[]];
export type PandocTableCell = [
  attr: PandocAttr,
  alignment: PandocAlignment,
  rowspan: number,
  colspan: number,
  blocks: PandocBlock[],
];
export interface PandocTable {
  t: "Table";
  c: [
    PandocAttr,
    [null, PandocInline[]],
    [PandocAlignment, PandocColWidth][],
    [PandocAttr, PandocRow[]],
    PandocTableBody[],
    [PandocAttr, PandocRow[]],
  ];
}

export type PandocBlock =
  | PandocPara
  | PandocPlain
  | PandocHeader
  | PandocBlockQuote
  | PandocCodeBlock
  | PandocBulletList
  | PandocOrderedList
  | PandocHorizontalRule
  | PandocDiv
  | PandocTable;

export interface PandocDocument {
  "pandoc-api-version": number[];
  meta: Record<string, unknown>;
  blocks: PandocBlock[];
}
