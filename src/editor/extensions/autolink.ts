import {
  combineTransactionSteps,
  findChildrenInRange,
  getChangedRanges,
  getMarksBetween,
} from "@tiptap/core";
import type { MarkRange } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { md } from "../markdown/md-instance";

/**
 * 裸 URL 自动链接(编辑器输入/粘贴路径),与 markdown-it 的 linkify-it 同引擎。
 *
 * 背景:Tiptap 内置 autolink 用 linkifyjs,会把「URL 后紧跟的逗号+括号」整段吞进
 * 链接,如 `http://a.local,(apk,gitlab流水线产物)` 全部成为链接;而打开文档走
 * md → HTML(linkify-it),URL 在 `,` 处正确截断。两条路径行为不一致且内置的错。
 * → extensions.ts 里关闭 Link 的 autolink/linkOnPaste,由本文件按 Tiptap v3
 * autolink 逻辑同源复刻,仅把 tokenizer 换成 md.linkify(linkify-it 6,非 fuzzy:
 * 裸域名不成链,与 md-open 路径一致)。另有 Typora 式实时成链:光标所在词一旦
 * 能被 linkify-it 匹配(`https://w` 起)立即成链,继续输入随匹配生长;词内
 * URL 之后的尾巴(如 `,(…)` 括注)实时摘除链接 mark,边界与存储态一致。
 */

/* 与 Tiptap v3 whitespace.ts 一致的 Unicode 空白集(NUL..空格、NBSP、U+1680、
 * U+180E、U+2000-2029、U+205F、U+3000) */
const UNICODE_WHITESPACE_PATTERN =
  "[\\0- \\u00A0\\u1680\\u180E\\u2000-\\u2029\\u205F\\u3000]";
const UNICODE_WHITESPACE_REGEX = new RegExp(UNICODE_WHITESPACE_PATTERN);
const UNICODE_WHITESPACE_REGEX_END = new RegExp(`${UNICODE_WHITESPACE_PATTERN}$`);

/** 链接 mark 不应延伸到紧随其后的空白(Tiptap unlinkTrailingWhitespace 同源)。 */
function unlinkTrailingWhitespace(
  tr: Transaction,
  range: { from: number; to: number },
  markType: MarkType,
): void {
  const rangeEnd = tr.doc.resolve(range.to);
  if (!rangeEnd.nodeBefore?.isText) return;
  const insertedText = tr.doc.textBetween(range.from, range.to, "￼", "￼");
  const trailingWhitespace = insertedText.match(new RegExp(`${UNICODE_WHITESPACE_PATTERN}+$`))?.[0];
  if (!trailingWhitespace) return;
  const whitespaceFrom = range.to - trailingWhitespace.length;
  const linkMarks = getMarksBetween(whitespaceFrom, range.to, tr.doc).filter(
    (item) => item.mark.type === markType,
  );
  if (!linkMarks.length) return;
  const { nodeAfter } = rangeEnd;
  if (nodeAfter && linkMarks.some((item) => item.mark.isInSet(nodeAfter.marks))) return;
  const storedMarks = tr.storedMarks;
  tr.removeMark(whitespaceFrom, range.to, markType);
  tr.setStoredMarks(storedMarks);
  if (tr.selection.empty && tr.selection.from === range.to) tr.removeStoredMark(markType);
}

/** 自动链接痕迹:auto 标记,或自引用形态(覆盖文本 === href,含历史落盘链接)。
 * 删除回退/实时生长只处理痕迹;用户改名的手动链接永不动。 */
function isArtifact(doc: PMNode, item: MarkRange, markType: MarkType): boolean {
  if (item.mark.type !== markType) return false;
  if (item.mark.attrs.auto === true) return true;
  const href = String(item.mark.attrs.href ?? "");
  if (!href) return false;
  // 删尾使 text 成为 href 前缀,生长使 href 成为 text 前缀,二者都算痕迹
  const text = doc.textBetween(item.from, item.to, "\uFFFC", "\uFFFC");
  return text.startsWith(href) || href.startsWith(text);
}

/** [from, to) 内每个文本节点都带该 mark 才算完整覆盖。 */
function hasMarkFully(doc: PMNode, from: number, to: number, markType: MarkType): boolean {
  let covered = true;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    if (!node.marks.some((mark) => mark.type === markType)) {
      covered = false;
      return false;
    }
    return true;
  });
  return covered;
}

/** 输入/删除后对变更范围的末词跑 linkify-it,给命中的 URL 加链接 mark。 */
export function yzAutolinkPlugin(
  markType: MarkType,
  shouldAutoLink: (url: string) => boolean,
): Plugin {
  return new Plugin({
    key: new PluginKey("yzAutolink"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanges =
        transactions.some((transaction) => transaction.docChanged) &&
        !oldState.doc.eq(newState.doc);
      const preventAutolink = transactions.some((transaction) =>
        transaction.getMeta("preventAutolink"),
      );
      if (!docChanges || preventAutolink) return;
      // 撤销/重做不参与:undo 摘链后不被 appendTransaction 立刻加回
      if (transactions.some(isHistoryTransaction)) return;
      const { tr } = newState;
      const transform = combineTransactionSteps(oldState.doc, [...transactions]);
      if (!transactions.some(isHistoryTransaction)) {
        const insertedRanges: { from: number; to: number }[] = [];
        transform.steps.forEach((step, index) => {
          if (!(step instanceof ReplaceStep) || !step.slice.size) return;
          const mapping = transform.mapping.slice(index + 1);
          const from = mapping.map(step.from, 1);
          const to = mapping.map(step.from + step.slice.size, -1);
          if (from < to) insertedRanges.push({ from, to });
        });
        insertedRanges.sort((left, right) => right.to - left.to);
        insertedRanges.forEach((range) => unlinkTrailingWhitespace(tr, range, markType));
      }
      getChangedRanges(transform).forEach(({ newRange }) => {
        // 实时成链(Typora 式):变更终点所在的词已能被 linkify-it 匹配即成链,
        // 不等空白;词内 URL 之后的尾巴实时摘除(保持与打开/存储同一截断边界)
        const $to = newState.doc.resolve(newRange.to);
        if ($to.parent.isTextblock && $to.parentOffset > 0) {
          const blockPos = $to.before();
          const textToCursor = $to.parent.textBetween(0, $to.parentOffset, undefined, " ");
          const lastWord = textToCursor.split(UNICODE_WHITESPACE_REGEX).filter(Boolean).pop();
          if (lastWord) {
            const matches = md.linkify.match(lastWord);
            const match = matches?.[matches.length - 1];
            if (!matches) {
              // 删除回退:词已不再构成链接,摘除词内自动链接痕迹变回文本。
              // 仅当词像 URL 残骸(含 :// 或 mailto: 前缀)才触发,
              // 避免误拆粘贴建链等非 URL 词上的 auto 链接(改名链接本就不含 auto)
              if (!/:\/\//.test(lastWord) && !lastWord.startsWith("mailto:")) {
                return;
              }
              const wordFrom = blockPos + 1 + textToCursor.lastIndexOf(lastWord);
              const wordTo = wordFrom + lastWord.length;
              const stale = getMarksBetween(wordFrom, wordTo, newState.doc).filter(
                (item) => isArtifact(newState.doc, item, markType),
              );
              if (stale.length) {
                const storedMarks = tr.storedMarks;
                for (const item of stale) tr.removeMark(item.from, item.to, markType);
                tr.setStoredMarks(storedMarks);
                if (tr.selection.empty && tr.selection.from >= wordFrom && tr.selection.from <= wordTo) {
                  tr.removeStoredMark(markType);
                }
              }
            }
            // 词不以 URL 开头不动(保护词中/词前的手动链接);无匹配也不动
            if (match && match.index === 0) {
              // match.index/lastIndex 相对「末词」,须先折算到段内偏移
              const wordStart = textToCursor.lastIndexOf(lastWord);
              const wordFrom = blockPos + 1 + wordStart;
              const from = wordFrom + match.index;
              const to = wordFrom + match.lastIndex;
              const wordTo = wordFrom + lastWord.length;
              const codeMark = newState.schema.marks.code;
              const inCode = codeMark && newState.doc.rangeHasMark(from, to, codeMark);
              if (!inCode) {
                // 只管理自动链接痕迹(auto 或自引用);改名链接不动
                const inRange = getMarksBetween(from, to, newState.doc).filter(
                  (item) => isArtifact(newState.doc, item, markType),
                );
                const hasManual = getMarksBetween(from, to, newState.doc).some(
                  (item) => item.mark.type === markType && !isArtifact(newState.doc, item, markType),
                );
                // 幂等守卫:已按当前匹配完整覆盖(auto + href 一致)时不再动,
                // 否则 appendTransaction 每轮 remove+add 都改 doc → 无限循环
                const exact =
                  hasMarkFully(newState.doc, from, to, markType) &&
                  inRange.length > 0 &&
                  inRange.every(
                    (item) =>
                      item.mark.attrs.href === match.url && item.mark.attrs.auto === true,
                  );
                if (!hasManual && !exact) {
                  for (const item of inRange) tr.removeMark(item.from, item.to, markType);
                  tr.addMark(from, to, markType.create({ href: match.url, auto: true }));
                }
                // 词内 URL 之后的尾巴(「,」开头的括注等)的痕迹摘链,手动链接不动
                for (const item of getMarksBetween(to, wordTo, newState.doc).filter(
                  (item) =>
                    item.mark.type === markType &&
                    (item.mark.attrs.href === match.url ||
                      isArtifact(newState.doc, item, markType)),
                )) {
                  tr.removeMark(item.from, item.to, markType);
                }
              }
            }
          }
        }
        const nodesInChangedRanges = findChildrenInRange(
          newState.doc,
          newRange,
          (node) => node.isTextblock,
        );
        let textBlock: (typeof nodesInChangedRanges)[number] | undefined;
        let textBeforeWhitespace: string | undefined;
        if (nodesInChangedRanges.length > 1) {
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            textBlock.pos + textBlock.node.nodeSize,
            undefined,
            " ",
          );
        } else if (nodesInChangedRanges.length) {
          const endText = newState.doc.textBetween(newRange.from, newRange.to, " ", " ");
          if (!UNICODE_WHITESPACE_REGEX_END.test(endText)) return;
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            newRange.to,
            undefined,
            " ",
          );
        }
        if (!textBlock || !textBeforeWhitespace) return;
        const wordsBeforeWhitespace = textBeforeWhitespace
          .split(UNICODE_WHITESPACE_REGEX)
          .filter(Boolean);
        if (wordsBeforeWhitespace.length <= 0) return;
        const lastWordBeforeSpace = wordsBeforeWhitespace[wordsBeforeWhitespace.length - 1];
        const lastWordAndBlockOffset =
          textBlock.pos + textBeforeWhitespace.lastIndexOf(lastWordBeforeSpace);
        if (!lastWordBeforeSpace) return;
        const matches = md.linkify.match(lastWordBeforeSpace) ?? [];
        const codeMark = newState.schema.marks.code;
        for (const match of matches) {
          const from = lastWordAndBlockOffset + match.index + 1;
          const to = lastWordAndBlockOffset + match.lastIndex + 1;
          // 已有链接/行内代码不重复套 mark(Tiptap 同源行为)
          if (
            getMarksBetween(from, to, newState.doc).some((item) => item.mark.type === markType)
          ) {
            continue;
          }
          if (codeMark && newState.doc.rangeHasMark(from, to, codeMark)) continue;
          if (!shouldAutoLink(match.url)) continue;
          tr.addMark(from, to, markType.create({ href: match.url, auto: true }));
        }
      });
      if (!tr.steps.length) return;
      return tr;
    },
  });
}

/** 选区粘贴「整段恰为一个 URL」→ 转链接(Tiptap linkOnPaste 同源,换 linkify-it)。 */
export function yzPasteLinkPlugin(
  editor: Editor,
  markType: MarkType,
  shouldAutoLink: (url: string) => boolean,
): Plugin {
  return new Plugin({
    key: new PluginKey("yzHandlePasteLink"),
    props: {
      handlePaste: (view, _event, slice) => {
        const { state } = view;
        if (state.selection.empty) return false;
        let textContent = "";
        slice.content.forEach((node) => {
          textContent += node.textContent;
        });
        if (!textContent) return false;
        const matches = md.linkify.match(textContent);
        if (!matches) return false;
        const full =
          matches.length === 1 &&
          matches[0].index === 0 &&
          matches[0].lastIndex === textContent.length;
        if (!full || !shouldAutoLink(matches[0].url)) return false;
        return editor.commands.setMark(markType, { href: matches[0].url, auto: true });
      },
    },
  });
}
