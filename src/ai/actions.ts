/**
 * AI 动作注册表(PRD §7.8):同一套上下文 → prompt → 回写 Schema。
 * AI-1 写作 + AI-2 结构;浮动条 / 右键 / 斜杠共用,避免一动作一套 UI。
 */

export type AiActionId =
  | "polish"
  | "continue"
  | "expand"
  | "shorten"
  | "tone"
  | "translate"
  | "explain"
  | "fix"
  | "summarize"
  | "outline"
  | "restructure"
  | "extractTodos"
  | "toTable"
  | "wikiSuggest";

export type AiResultBias = "replace" | "insert";
export type AiActionGroup = "write" | "structure";

export interface AiActionDef {
  id: AiActionId;
  label: string;
  /** 斜杠/搜索关键词 */
  keywords: string[];
  /** 无选区是否可用(仅续写) */
  allowEmptySelection: boolean;
  /** 默认结果倾向 */
  bias: AiResultBias;
  /** 写作(AI-1) / 结构(AI-2) */
  group: AiActionGroup;
  /**
   * 替换时强制走块级 Markdown 回写。
   * 结构类会产出标题/列表/表格,不能走「同块行内替换」路径。
   */
  blockApply?: boolean;
  /** 需要二次选项(语气/目标语言) */
  option?: "tone" | "lang";
  /**
   * 请求中文案(接在「正在」后)。缺省用 label。
   * 如「双链建议」→ runningLabel「挑选相关双链」,避免「正在双链建议」。
   */
  runningLabel?: string;
  system: string;
  /** 把用户上下文拼进 user 消息 */
  userPrompt: (ctx: string, option?: string) => string;
}

const OUTPUT_MD =
  "只输出可用的 Markdown 正文,不要解释过程,不要用代码围栏包裹全文,不要加前后客套话;替换选区时只输出选区对应片段,不要额外添加标题/列表/引用等块级语法。";

const OUTPUT_STRUCT =
  "只输出可用的 Markdown 正文,不要解释过程,不要用代码围栏包裹全文,不要加前后客套话。允许并需要使用标题、列表、表格等块级语法。";

export const AI_ACTIONS: AiActionDef[] = [
  {
    id: "polish",
    label: "润色",
    keywords: ["ai", "polish", "runse", "润色"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    system: `你是中文写作润色助手。改通顺、去口语赘余,保留原意与事实。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请润色以下文字:\n\n${ctx}`,
  },
  {
    id: "continue",
    label: "续写",
    keywords: ["ai", "continue", "xuxie", "续写"],
    allowEmptySelection: true,
    bias: "insert",
    group: "write",
    system: `你是中文续写助手。紧接上文自然续写,文风一致,不要重复上文已有句子。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请根据上文续写:\n\n${ctx}`,
  },
  {
    id: "expand",
    label: "扩写",
    keywords: ["ai", "expand", "kuoxie", "扩写"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    system: `你是中文扩写助手。把短句或提纲写丰满,不编造与原文冲突的事实。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请扩写:\n\n${ctx}`,
  },
  {
    id: "shorten",
    label: "缩写",
    keywords: ["ai", "shorten", "suoxie", "精简", "缩写"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    system: `你是中文精简助手。压缩篇幅、去重复,保留关键信息。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请精简:\n\n${ctx}`,
  },
  {
    id: "tone",
    label: "改语气",
    keywords: ["ai", "tone", "yuqi", "语气"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    option: "tone",
    system: `你是中文改写助手。按指定语气改写,保留原意。${OUTPUT_MD}`,
    userPrompt: (ctx, opt) => `请改写成「${opt ?? "正式"}」语气:\n\n${ctx}`,
  },
  {
    id: "translate",
    label: "翻译",
    keywords: ["ai", "translate", "fanyi", "翻译"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    option: "lang",
    system: `你是翻译助手。只输出译文。${OUTPUT_MD}`,
    userPrompt: (ctx, opt) => `请翻译为${opt ?? "英文"}:\n\n${ctx}`,
  },
  {
    id: "explain",
    label: "解释",
    keywords: ["ai", "explain", "jieshi", "解释"],
    allowEmptySelection: false,
    bias: "insert",
    group: "write",
    system: `你是讲解助手。用简洁中文说明选区含义,可分点。不要改写原文本身。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请解释以下内容:\n\n${ctx}`,
  },
  {
    id: "fix",
    label: "纠错",
    keywords: ["ai", "fix", "jiucuo", "纠错"],
    allowEmptySelection: false,
    bias: "replace",
    group: "write",
    system: `你是中文校对助手。修正错别字、标点与明显病句,尽量少改措辞。${OUTPUT_MD}`,
    userPrompt: (ctx) => `请纠错:\n\n${ctx}`,
  },
  {
    id: "summarize",
    label: "总结为要点",
    keywords: ["ai", "summarize", "zongjie", "总结", "要点"],
    allowEmptySelection: false,
    bias: "insert",
    group: "write",
    system: `你是总结助手。把内容整理为 Markdown 无序列表要点;必要时可用 > [!INFO] 要点 形式的 Callout 包一层。${OUTPUT_STRUCT}`,
    userPrompt: (ctx) => `请总结为要点:\n\n${ctx}`,
  },
  // —— AI-2 结构 ——
  {
    id: "outline",
    label: "生成大纲",
    keywords: ["ai", "outline", "dagang", "大纲", "目录"],
    allowEmptySelection: false,
    bias: "insert",
    group: "structure",
    system: `你是中文大纲助手。根据正文提炼层级大纲,用 Markdown 标题(## / ###)或有序列表表达结构,保留原意,不扩写正文。${OUTPUT_STRUCT}`,
    userPrompt: (ctx) => `请为以下内容生成大纲:\n\n${ctx}`,
  },
  {
    id: "restructure",
    label: "拆段加小标题",
    keywords: ["ai", "restructure", "chaiduan", "拆段", "小标题", "结构"],
    allowEmptySelection: false,
    bias: "replace",
    group: "structure",
    blockApply: true,
    system: `你是中文结构化助手。把长文拆成若干小节:每节以 ## 或 ### 小标题开头,后接通顺段落;不编造事实,尽量保留原句与关键信息。${OUTPUT_STRUCT}`,
    userPrompt: (ctx) => `请拆段并加小标题:\n\n${ctx}`,
  },
  {
    id: "extractTodos",
    label: "提取待办",
    keywords: ["ai", "todo", "todos", "daiban", "待办", "任务"],
    allowEmptySelection: false,
    bias: "insert",
    group: "structure",
    system: `你是待办提取助手。从文本中抽出可执行任务,输出 GFM 任务列表(- [ ] 项)。每项一句、可勾选;无待办时输出空列表或一句说明。不要改写原文本身。${OUTPUT_STRUCT}`,
    userPrompt: (ctx) => `请提取待办:\n\n${ctx}`,
  },
  {
    id: "toTable",
    label: "整理为表格",
    keywords: ["ai", "table", "biaoge", "表格", "gfm"],
    allowEmptySelection: false,
    bias: "replace",
    group: "structure",
    blockApply: true,
    system: `你是表格整理助手。把列举、对照、属性类内容整理为单个 GFM 管道表格(| 列 | … | 与对齐分隔行)。不要单元格合并,不要表格外解释。${OUTPUT_STRUCT}`,
    userPrompt: (ctx) => `请整理为 GFM 表格:\n\n${ctx}`,
  },
  {
    id: "wikiSuggest",
    label: "双链建议",
    keywords: ["ai", "wiki", "shuangalian", "双链", "wikilink"],
    allowEmptySelection: false,
    bias: "insert",
    group: "structure",
    runningLabel: "挑选相关双链",
    system: `你是双链建议助手。只能从用户给出的「候选文档」里挑选与正文相关的项。
规则:输出 Markdown 无序列表,每项必须是 - [[…]],且 [[]] 内必须与候选逐字一致;禁止改写、禁止发明候选之外的标题;没有合适的只输出一行「（无）」;不要解释。${OUTPUT_STRUCT}`,
    /** option = 预格式化的候选列表(每行 - [[target]]) */
    userPrompt: (ctx, catalog) =>
      `候选文档(只能从下列原样选用):\n${catalog?.trim() || "（无候选）"}\n\n正文:\n${ctx}\n\n请挑选与正文相关的候选;没有合适的只输出「（无）」。`,
  },
];

export const TONE_OPTIONS = ["正式", "口语", "技术文档"] as const;
export const LANG_OPTIONS = ["英文", "中文"] as const;

export function aiActionById(id: AiActionId): AiActionDef {
  return AI_ACTIONS.find((a) => a.id === id)!;
}
