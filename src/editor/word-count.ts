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

/** 文档级统计(状态栏弹窗):字数/字符/段落/图片/表格/阅读时长 */
export interface DocStats {
  /** 字数(中文按字、西文按词,同 countWords) */
  words: number;
  /** 字符数(不含空白) */
  chars: number;
  /** 段落数(所有 paragraph 节点,含列表内段落) */
  paragraphs: number;
  /** 图片数 */
  images: number;
  /** 表格数 */
  tables: number;
  /** 待办总数 */
  tasksTotal: number;
  /** 已完成待办数 */
  tasksDone: number;
  /** 预计阅读时长(分钟,按 300 字/分) */
  readMinutes: number;
}

/** 中文阅读速度(字/分钟),用于「预计阅读 X 分钟」 */
const READ_SPEED = 300;

/** 纯文本节点统计(不含图片/表格);图片表格需遍历 doc,见 countDocStats */
export function countTextStats(text: string): Pick<DocStats, "words" | "chars"> {
  return {
    words: countWords(text),
    chars: text.replace(/\s/g, "").length,
  };
}

/**
 * 文档统计(纯函数,单测锁定):遍历 PM doc 数段落/图片/表格。
 * 只读 doc 结构,不渲染、不改内容。
 */
export function countDocStats(doc: {
  textContent: string;
  descendants: (
    fn: (node: {
      type: { name: string };
      isText: boolean;
      attrs?: { checked?: boolean };
    }) => boolean | void,
  ) => void;
}): DocStats {
  let paragraphs = 0;
  let images = 0;
  let tables = 0;
  let tasksTotal = 0;
  let tasksDone = 0;
  doc.descendants((node) => {
    const name = node.type.name;
    if (name === "paragraph") paragraphs += 1;
    else if (name === "image") images += 1;
    else if (name === "table") tables += 1;
    else if (name === "taskItem") {
      tasksTotal += 1;
      if (node.attrs?.checked) tasksDone += 1;
    }
    return true;
  });
  const { words, chars } = countTextStats(doc.textContent);
  return {
    words,
    chars,
    paragraphs,
    images,
    tables,
    tasksTotal,
    tasksDone,
    readMinutes: Math.max(1, Math.round(words / READ_SPEED)),
  };
}
