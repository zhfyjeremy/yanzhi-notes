/**
 * HTML 源码 ↔ 渲染结果的文本位置映射。
 *
 * 需求:点击渲染出来的 HTML → 打开该块的源码编辑,并把光标落到「点到的那个字符」上
 * (Typora 行为)。渲染发生在隔离 iframe 里,源码是一段字符串,两者之间没有 DOM 关系,
 * 只能靠「规范化后的可见文本」做对齐:
 *
 *   1. 源码 → 规范化文本 + 每个字符在源码里的下标(buildDecodedTextMap):
 *      跳过标签/注释/script/style,解码实体,连续 ASCII 空白折叠成一个空格;
 *   2. iframe 正文 → 同样规则的规范化文本 + 每个文本节点在其中的区间
 *      (normalizedTextOf);
 *   3. 命中点 → 文本节点 + 节点内偏移(hitAtPoint);
 *   4. 命中节点 → 源码字符下标(sourceOffsetForHit):
 *      用「同文本节点在 iframe 中的出现次序」消歧,避免同名文本定位到别的块;
 *      对不上时退回上下文窗口匹配,再退到按标签序号粗定位。
 *
 * 两边用同一套空白折叠规则,正常情况下规范化文本逐字相等;清洗器删掉带文字的
 * 节点(如 form)时窗口匹配会失败,退路保证仍能落到一个合理位置。
 */

export interface DecodedTextMap {
  /** 规范化后的可见文本(实体已解码、空白已折叠) */
  text: string;
  /** map[i] = text[i] 在源码中的字符下标 */
  map: number[];
}

export interface NormalizedText {
  /** 规范化后的可见文本 */
  text: string;
  /** 各文本节点在规范化文本中的区间(按文档顺序) */
  ranges: { node: Text; start: number; length: number }[];
}

export interface FrameHit {
  /** 命中的文本节点(元素命中时为 null) */
  node: Text | null;
  /** 节点内偏移(字符下标) */
  offset: number;
  /** 命中的元素(文本节点的父元素,或直接命中的元素) */
  element: Element | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

const ENTITY_RE = /^&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

/** ASCII 空白(HTML 折叠规则);NBSP 不在其列 */
function isAsciiSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/** 从 index 处解一个实体;不是合法实体返回 null */
function decodeEntityAt(
  source: string,
  index: number,
): { text: string; length: number } | null {
  const match = ENTITY_RE.exec(source.slice(index, index + 40));
  if (!match) return null;
  const body = match[1];
  if (body.startsWith("#")) {
    const isHex = body[1] === "x" || body[1] === "X";
    const code = isHex
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    try {
      return { text: String.fromCodePoint(code), length: match[0].length };
    } catch {
      return null;
    }
  }
  const named = NAMED_ENTITIES[body.toLowerCase()];
  if (named == null) return null;
  return { text: named, length: match[0].length };
}

/** script/style 的内容不参与渲染,必须从文本映射里排除(否则会错位) */
function skipRawTextTag(source: string, index: number): number {
  const match = /^<(script|style)\b/i.exec(source.slice(index, index + 16));
  if (!match) return -1;
  const close = source.toLowerCase().indexOf(`</${match[1].toLowerCase()}`, index);
  if (close === -1) return source.length;
  const gt = source.indexOf(">", close);
  return gt === -1 ? source.length : gt + 1;
}

/**
 * 源码 → 可见纯文本 + 字符位置映射。
 * 标签整体跳过(注释/script/style 内容一并跳过),实体解码,连续空白折叠成一个空格。
 */
export function buildDecodedTextMap(source: string): DecodedTextMap {
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  let lastWasSpace = true; // 行首空白按 HTML 规则丢弃

  const push = (ch: string, srcIndex: number) => {
    if (isAsciiSpace(ch)) {
      if (lastWasSpace) return;
      lastWasSpace = true;
      chars.push(" ");
      map.push(srcIndex);
      return;
    }
    lastWasSpace = false;
    chars.push(ch);
    map.push(srcIndex);
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "<") {
      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i + 4);
        i = end === -1 ? source.length : end + 3;
        continue;
      }
      const rawEnd = skipRawTextTag(source, i);
      if (rawEnd !== -1) {
        i = rawEnd;
        continue;
      }
      // 跳过标签本身:> 可能出现在引号属性值里
      let j = i + 1;
      let quote: string | null = null;
      while (j < source.length) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }
      i = j < source.length ? j + 1 : source.length;
      continue;
    }
    const entity = decodeEntityAt(source, i);
    if (entity) {
      push(entity.text, i);
      i += entity.length;
      continue;
    }
    push(ch, i);
    i++;
  }

  // 末尾空白按 HTML 规则丢弃(与浏览器渲染一致)
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }

  return { text: chars.join(""), map };
}

/**
 * 原始文本 → 规范化文本 + 字符位置映射(与 buildDecodedTextMap 同一套空白规则)。
 * 用于把单个文本节点的内容与源码文本对齐。
 */
export function normalizeText(raw: string): DecodedTextMap {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (isAsciiSpace(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      chars.push(" ");
      map.push(i);
      continue;
    }
    lastWasSpace = false;
    chars.push(ch);
    map.push(i);
  }
  return { text: chars.join(""), map };
}

/** DOM 正文 → 规范化文本 + 文本节点区间(与源码同一套空白规则) */
export function normalizedTextOf(root: Node): NormalizedText {
  const chars: string[] = [];
  const ranges: NormalizedText["ranges"] = [];
  let lastWasSpace = true;

  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const raw = textNode.textContent ?? "";
    const start = chars.length;
    for (const ch of raw) {
      if (isAsciiSpace(ch)) {
        if (lastWasSpace) continue;
        lastWasSpace = true;
        chars.push(" ");
      } else {
        lastWasSpace = false;
        chars.push(ch);
      }
    }
    ranges.push({ node: textNode, start, length: chars.length - start });
    current = walker.nextNode();
  }

  // 末尾空白丢弃(与 buildDecodedTextMap 同口径,保证两侧文本逐字相等)
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    const last = ranges[ranges.length - 1];
    if (last) last.length = Math.max(0, last.length - 1);
  }

  return { text: chars.join(""), ranges };
}

/**
 * 规范化下标:原始下标 rawOffset 对应到规范化文本里的位置。
 * 折叠掉的空白不占位,取第一个原始下标 >= rawOffset 的规范化位置。
 */
function normalizedPosAt(norm: DecodedTextMap, rawOffset: number): number {
  let lo = 0;
  let hi = norm.map.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (norm.map[mid] < rawOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 在 text 里找第 ordinal 个 needle 的起始下标;找不到返回 -1 */
function nthIndexOf(text: string, needle: string, ordinal: number): number {
  if (!needle) return -1;
  let idx = -1;
  let from = 0;
  for (let i = 0; i <= ordinal; i++) {
    idx = text.indexOf(needle, from);
    if (idx === -1) return -1;
    from = idx + needle.length;
  }
  return idx;
}

/**
 * 命中点 → 源码字符下标。
 *
 * 主路径:取命中文本节点的规范化内容,在源码规范化文本里找**同序号的第 N 处**
 * (同文本节点在 iframe 中出现的次序)→ 命中时偏移按规范化位置换算。
 * 同名文本出现多次时也不会定位到别的块。
 *
 * 窗口匹配失败(清洗器删过带文字节点)时退回按上下文窗口定位,再退到按标签序号粗定位。
 */
export function sourceOffsetForHit(
  source: string,
  sourceMap: DecodedTextMap,
  frameText: NormalizedText,
  hit: FrameHit,
): number | null {
  const range = hit.node
    ? frameText.ranges.find((item) => item.node === hit.node)
    : undefined;

  if (range) {
    const raw = hit.node?.textContent ?? "";
    const norm = normalizeText(raw);
    if (norm.text) {
      // 同文本节点在 iframe 中的出现次序(用于消歧)
      let ordinal = 0;
      for (const item of frameText.ranges) {
        if (item.node === hit.node) break;
        if (normalizeText(item.node.textContent ?? "").text === norm.text) ordinal++;
      }
      const found = nthIndexOf(sourceMap.text, norm.text, ordinal);
      if (found !== -1) {
        const within = normalizedPosAt(norm, hit.offset);
        const sourceIndex = found + Math.min(within, norm.text.length - 1);
        return sourceMap.map[sourceIndex] ?? null;
      }
    }

    // 窗口匹配兜底:取命中位置前后的上下文,在源码规范化文本里定位
    const frameIndex = range.start + Math.min(hit.offset, range.length);
    const windowSize = 80;
    const winStart = Math.max(0, frameIndex - windowSize);
    const winEnd = Math.min(frameText.text.length, frameIndex + windowSize);
    const windowText = frameText.text.slice(winStart, winEnd);
    if (windowText) {
      const found = sourceMap.text.indexOf(windowText);
      if (found !== -1) {
        const sourceIndex = found + (frameIndex - winStart);
        return sourceMap.map[sourceIndex] ?? null;
      }
    }
  }

  return sourceOffsetForElement(source, hit.element);
}

/**
 * 无文本节点时的兜底:按同标签在 iframe 文档中的序号,对应到源码里的第 N 个同名标签。
 */
export function sourceOffsetForElement(
  source: string,
  element: Element | null,
): number | null {
  if (!element) return null;
  const tag = element.tagName.toLowerCase();
  const doc = element.ownerDocument;
  let ordinal = 0;
  if (doc) {
    const all = Array.from(doc.getElementsByTagName(tag));
    const idx = all.indexOf(element);
    ordinal = idx > 0 ? idx : 0;
  }
  const re = new RegExp(`<${tag}(?![a-zA-Z0-9-])`, "gi");
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = re.exec(source)) !== null) {
    if (seen === ordinal) return match.index;
    seen++;
  }
  const first = re.exec(source);
  return first ? first.index : null;
}

/**
 * iframe 内的命中检测:把页面坐标换算成 iframe 内部坐标后取光标位置。
 * scale 为预览的等比缩放系数(transform-origin 0 0,左上角对齐)。
 */
export function hitAtPoint(
  frame: HTMLIFrameElement,
  clientX: number,
  clientY: number,
  scale: number,
): FrameHit | null {
  const doc = frame.contentDocument;
  if (!doc) return null;

  const rect = frame.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const ratio = scale > 0 ? scale : 1;
  const x = (clientX - rect.left) / ratio;
  const y = (clientY - rect.top) / ratio;

  const scope = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    webkitCaretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof scope.caretPositionFromPoint === "function") {
    const pos = scope.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node) {
    const rangeFn = scope.caretRangeFromPoint ?? scope.webkitCaretRangeFromPoint;
    if (typeof rangeFn === "function") {
      const range = rangeFn.call(scope, x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }
  }
  if (!node) return null;

  if (node.nodeType === 3) {
    const textNode = node as Text;
    return { node: textNode, offset, element: textNode.parentElement };
  }

  // 元素命中:取其内第一个文本节点;没有则按元素本身处理
  const element = node as Element;
  const child = element.childNodes[offset] ?? null;
  if (child && child.nodeType === 3) {
    return { node: child as Text, offset: 0, element };
  }
  return { node: null, offset: 0, element };
}
