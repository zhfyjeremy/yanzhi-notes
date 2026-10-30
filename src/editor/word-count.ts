/**
 * 字数统计(状态栏):中文按字计数,西文按词计数(语雀/Typora 同口径)。
 * 标点与空白不计;代码块文本按普通文本同规则统计。
 */

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const WORD_RE = /[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)*/g;

export function countWords(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  const words = (text.replace(CJK_RE, " ").match(WORD_RE) ?? []).length;
  return cjk + words;
}
