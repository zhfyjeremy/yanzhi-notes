/** 知识库前端类型(与 src-tauri/src/kb.rs 的 serde 输出对齐) */

export interface TreeNode {
  name: string;
  path: string; // 相对库根,POSIX 风格
  isDir: boolean;
  children: TreeNode[];
}

export interface RecentState {
  last: string | null;
  recent: string[];
  lastDoc?: string | null;
}

/** 单文件模式的最近打开记录(应用配置;与知识库 recent 分离) */
export interface RecentFilesState {
  recent: string[];
}

/** 单文件崩溃恢复草稿(只存应用配置,不改原文件) */
export interface SingleDraft {
  path: string;
  content: string;
  savedAt: number;
}

/** rename_entry 返回:新路径 + 引用被联动改写的文档 + 替换次数(5.1 重命名联动) */
export interface RenameResult {
  newPath: string;
  updatedFiles: string[];
  refCount: number;
}

/** read_all_docs 单条(搜索索引构建用) */
export interface DocContent {
  path: string;
  content: string;
}

/** 回收站条目(5.1.1):path = 原相对路径 */
export interface TrashEntry {
  path: string;
  isDir: boolean;
  docs: number;
}

/** 工作区标签页持久化结构(.yanzhi/workspace.json) */
export interface WorkspaceState {
  version: 1;
  /** 文档相对路径,顺序即标签页顺序 */
  tabs: string[];
  activePath: string | null;
}

/** 历史快照条目(6.2):索引即文件名 `<unix_ms>-<a|m>-<内容哈希>.md`,无独立索引文件 */
export interface HistoryEntry {
  id: string;
  /** 快照时间(unix 毫秒) */
  time: number;
  /** true = 自动快照(受节流),false = 手动「打快照」 */
  auto: boolean;
  /** 字符数(面板展示) */
  chars: number;
}

/** 附件导入结果(6.1.5):name=原文件名(卡片显示名),src=`./assets/<hash>.<ext>` */
export interface AttachmentInfo {
  name: string;
  src: string;
}

export interface PandocStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
  error: string | null;
}

export interface DocxExportRequest {
  outputPath: string;
  ast: unknown;
  resourcePath: string | null;
  remoteImages: string[];
  downloadRemoteImages: boolean;
  pandocPath: string | null;
  referenceDocPath: string | null;
}

export interface DocxExportResult {
  path: string;
  warnings: string[];
  remoteEmbedded: number;
  remoteFailed: number;
}

/** 知识库后端能力面:tauri(真文件系统)与 browser(localStorage mock)同构 */
export interface KbBackend {
  readonly kind: "tauri" | "browser";
  pickFolder(): Promise<string | null>;
  createKb(root: string): Promise<void>; // 非空目录抛 { kind: "NOT_EMPTY" }
  forceCreateKb(root: string): Promise<void>;
  openKb(root: string): Promise<void>;
  scanTree(root: string): Promise<TreeNode[]>;
  readDoc(root: string, rel: string): Promise<string>;
  writeDoc(root: string, rel: string, content: string): Promise<void>;
  /** content = 模板新建时的初始正文(7.5);缺省建空文档(标题来自文件名,9.2) */
  createDoc(root: string, folderRel: string, title: string, content?: string): Promise<string>;
  /* ---- 文档模板(7.5:.yanzhi/templates/*.md,文件名即模板名) ---- */
  listTemplates(root: string): Promise<string[]>;
  readTemplate(root: string, name: string): Promise<string>;
  /** 应用内模板管理(7.5):写/新建(目录缺失则建)、删除 */
  writeTemplate(root: string, name: string, content: string): Promise<void>;
  deleteTemplate(root: string, name: string): Promise<void>;
  openTemplatesDir(root: string): Promise<void>;
  createFolder(root: string, folderRel: string, name: string): Promise<string>;
  moveToTrash(root: string, rel: string): Promise<string>;
  renameEntry(root: string, rel: string, newTitle: string): Promise<RenameResult>;
  /** 移动(改父目录,名字不变;拖拽调整层级 5.1) */
  moveEntry(root: string, src: string, destFolder: string): Promise<RenameResult>;
  readMeta(root: string): Promise<string>;
  writeMeta(root: string, content: string): Promise<void>;
  /* ---- 工作区标签页(5.x UI 偏好;仅路径,不存文档内容) ---- */
  readWorkspace(root: string): Promise<string>;
  writeWorkspace(root: string, content: string): Promise<void>;
  getRecent(): Promise<RecentState>;
  setRecent(root: string): Promise<void>;
  /* ---- 单文件模式(docs/single-file-mode.md) ---- */
  pickSingleFile(): Promise<string | null>;
  readSingleFile(path: string): Promise<string>;
  writeSingleFile(path: string, content: string): Promise<void>;
  saveSingleFileAs(defaultName: string, content: string): Promise<string | null>;
  watchSingleFile(path: string): Promise<void>;
  closeSingleFile(path: string): Promise<void>;
  getRecentFiles(): Promise<RecentFilesState>;
  setRecentFile(path: string): Promise<void>;
  listenSingleFileEvent(cb: (path: string) => void): Promise<() => void>;
  /* ---- 单文件 P1 ---- */
  saveSingleAsset(path: string, ext: string, bytes: Uint8Array): Promise<string>;
  importSingleImagesFromPicker(path: string): Promise<string[] | null>;
  importSingleAttachmentsFromPicker(path: string): Promise<AttachmentInfo[] | null>;
  openSingleAttachment(path: string, src: string): Promise<"ok" | "missing" | "unsupported">;
  readSingleAssetBase64(path: string, src: string): Promise<{ data: string; mime: string } | null>;
  resolveSingleAssetSrc(path: string, src: string): string;
  saveSingleToKb(root: string, path: string, content: string, assetSrcs: string[]): Promise<string>;
  saveSingleDraft(path: string, content: string): Promise<void>;
  getSingleDraft(path: string): Promise<SingleDraft | null>;
  clearSingleDraft(path: string): Promise<void>;
  takeStartupSingleFile(): Promise<string | null>;
  /* ---- 全局设置(8:应用配置目录 / mock localStorage) ---- */
  getSettings(): Promise<string>;
  setSettings(content: string): Promise<void>;
  setLastDoc(rel: string): Promise<void>;
  /* ---- M3 增量 ---- */
  /** 一次读全库(千文档级逐篇 readDoc 的 IPC 往返不可接受) */
  readAllDocs(root: string): Promise<DocContent[]>;
  /** 回收站内全部 md(反向链接「已删除」来源);path = 原相对路径 */
  readAllTrashDocs(root: string): Promise<DocContent[]>;
  /** 粘贴/拖拽图片字节落盘(9.3),返回 `./assets/<hash>.<ext>` */
  saveAsset(root: string, docRel: string, ext: string, bytes: Uint8Array): Promise<string>;
  /** 斜杠菜单「图片」文件选择 → 落盘;取消返回 null */
  importImagesFromPicker(root: string, docRel: string): Promise<string[] | null>;
  /** 斜杠菜单「附件」文件选择(任意类型,6.1.5)→ 落盘;name=原文件名(显示名);取消返回 null */
  importAttachmentsFromPicker(root: string, docRel: string): Promise<AttachmentInfo[] | null>;
  /** 附件卡片点击:解析库内路径 → 系统打开;missing=文件不存在/路径越界,unsupported=浏览器 mock */
  openPath(root: string, docRel: string, src: string): Promise<"ok" | "missing" | "unsupported">;
  /** 图片 src 渲染解析(同步;img src 不能等 Promise) */
  resolveAssetSrc(root: string, docRel: string, src: string): string;
  resolveAssetSrc(root: string, docRel: string, src: string): string;
  /** 回收站列表/恢复;冲突且未给 strategy 抛 KbConflictError */
  listTrash(root: string): Promise<TrashEntry[]>;
  restoreTrash(root: string, rel: string, strategy?: "overwrite" | "rename"): Promise<string>;
  /** 彻底删除回收站单条(不可恢复)/ 清空回收站 */
  purgeTrash(root: string, rel: string): Promise<void>;
  emptyTrash(root: string): Promise<void>;
  /** 导入外部 Markdown(5.6);取消返回 null;返回落库后的相对路径 */
  importDocsFromPicker(root: string, folderRel: string): Promise<string[] | null>;
  /** 导出落盘(保存对话框);取消返回 null */
  exportText(defaultName: string, filterExt: string, content: string): Promise<string | null>;
  /** 选择 DOCX 保存位置;取消返回 null */
  pickDocxOutputPath(defaultName: string): Promise<string | null>;
  /** DOCX 导出:PM doc 先在前端转 Pandoc AST,Rust 只调用本地 Pandoc */
  exportDocx(request: DocxExportRequest): Promise<DocxExportResult>;
  /** 检测 Pandoc 3+;browser mock 恒为未安装 */
  detectPandoc(pandocPath: string | null): Promise<PandocStatus>;
  /** 选择 Pandoc / Word reference doc;取消返回 null */
  pickExportPath(kind: "pandoc" | "reference-docx"): Promise<string | null>;
  /** 导出 HTML 内联图片用 */
  readAssetBase64(root: string, rel: string): Promise<{ data: string; mime: string } | null>;
  /** V3 未引用资源清理:列出知识库内所有 assets/ 文件(相对路径) */
  listAssets(root: string): Promise<string[]>;
  /** 删除明确的 assets/ 文件;后端拒绝 assets 之外的路径 */
  deleteAssets(root: string, rels: string[]): Promise<number>;
  /* ---- 历史快照(6.2,.yanzhi/history,与 Rust kb.rs 同构) ---- */
  /** 时间倒序;无快照 = 空数组 */
  listHistory(root: string, rel: string): Promise<HistoryEntry[]>;
  /** 读快照内容;id 非法/不存在抛错 */
  readHistory(root: string, rel: string, id: string): Promise<string>;
  /** 写入快照并按 keep 自动清理最旧(keep 至少保留本次);返回新条目 */
  saveSnapshot(root: string, rel: string, content: string, auto: boolean, keep: number): Promise<HistoryEntry>;
  /** 按 keep 立刻裁剪全库历史;返回删除份数(设置调小 / 开库兜底) */
  pruneHistory(root: string, keep: number): Promise<number>;
  /** 订阅库内文件外部变动(notify 去抖后);返回退订函数 */
  listenFsEvent(cb: (paths: string[]) => void): Promise<() => void>;
}
