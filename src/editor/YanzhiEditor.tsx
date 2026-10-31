import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { baseExtensions } from "./extensions";
import { mdToHtml } from "./markdown/md-instance";
import { docToMarkdown } from "./markdown/serialize";
import {
  SlashMenuExtension,
  setSlashAttachmentPicker,
  setSlashImagePicker,
} from "./slash-command";
import { setAttachmentOpener } from "./extensions/attachment";
import { cleanPastedHtml } from "./paste-clean";
import { insertImage } from "./extensions/image-card";
import { isImageFile } from "../kb/image-compress";
import { ImageLightbox } from "./panel/ImageLightbox";
import { closeFind, FindReplaceExtension, setSearch } from "./find-replace";
import { EditorToolbar } from "./toolbar/EditorToolbar";
import { FindReplaceBar } from "./toolbar/FindReplaceBar";
import { ImageToolbar } from "./toolbar/ImageToolbar";
import { TableToolbar } from "./toolbar/TableToolbar";
import { WikiLinkSuggestExtension, type WikiDocRef } from "./wiki-link-command";
import "./editor.css";

/**
 * M1 正式编辑器组件:markdown 进(md → HTML → 编辑器 DOMParser)、markdown 出(单路径序列化)。
 * onUpdate 去抖 300ms 回调 onMarkdownChange;自动保存落盘在 useKb(M3)。
 */

const CHANGE_DEBOUNCE_MS = 300;

/** 粘贴/拖拽进来的图片文件(剪贴板含 files 时优先于 HTML 清洗路径) */
const imageFilesOf = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter(isImageFile);

interface YanzhiEditorProps {
  /** 初始与外部切换内容(openDoc 后 prop 变化 → setContent 重载) */
  markdown: string;
  onMarkdownChange?: (markdown: string) => void;
  /** 编辑器实例就绪后回调(TOC 等外层面板消费) */
  onReady?: (editor: Editor) => void;
  /** 编辑区滚动容器挂载回调(滚动联动面板消费) */
  scrollContainerRef?: (el: HTMLDivElement | null) => void;
  /** `[[` 检索文档列表(每次唤起取最新;见 wiki-link-command) */
  wikiDocs?: () => WikiDocRef[];
  /** 点击双链跳转(应用层负责解析目标,未命中提示「目标不存在或已移动」) */
  onOpenWikiLink?: (target: string) => void;
  /** 粘贴/拖拽图片字节 → assets 落盘,返回可插入 src;由应用层接知识库 */
  onImageFiles?: (files: File[]) => Promise<string[]>;
  /** 斜杠菜单「图片」的文件选择入口(返回 src 列表,取消 null) */
  onPickImage?: () => Promise<string[] | null>;
  /** 斜杠菜单「附件」的文件选择入口(返回名称+相对路径列表,取消 null;6.1.5) */
  onPickAttachment?: () => Promise<{ name: string; href: string }[] | null>;
  /** 点击附件卡唤起系统打开(应用层解析库内路径并提示失败;6.1.5) */
  onOpenAttachment?: (href: string) => void;
  /** 全局搜索定位信号(打开文档后跳首个命中并高亮,seq 保证同文档也能触发) */
  locateSignal?: { term: string; seq: number } | null;
  /** §8 编辑器设置:特殊卡片边框;false → 容器挂 yz-flat-cards(边框透明) */
  cardBorder?: boolean;
  /** 显示菜单「工具栏」:编辑器顶部格式条,默认显示 */
  showToolbar?: boolean;
}

export function YanzhiEditor({
  markdown,
  onMarkdownChange,
  onReady,
  scrollContainerRef,
  wikiDocs,
  onOpenWikiLink,
  onImageFiles,
  onPickImage,
  onPickAttachment,
  onOpenAttachment,
  locateSignal,
  cardBorder = true,
  showToolbar = true,
}: YanzhiEditorProps) {
  // 回调走 ref:onUpdate 闭包不随父组件重渲染重建
  const onChangeRef = useRef(onMarkdownChange);
  onChangeRef.current = onMarkdownChange;
  const wikiDocsRef = useRef(wikiDocs);
  wikiDocsRef.current = wikiDocs;
  const openWikiRef = useRef(onOpenWikiLink);
  openWikiRef.current = onOpenWikiLink;
  const imageFilesRef = useRef(onImageFiles);
  imageFilesRef.current = onImageFiles;
  const pickImageRef = useRef(onPickImage);
  pickImageRef.current = onPickImage;
  const pickAttachmentRef = useRef(onPickAttachment);
  pickAttachmentRef.current = onPickAttachment;
  const openAttachmentRef = useRef(onOpenAttachment);
  openAttachmentRef.current = onOpenAttachment;
  const timerRef = useRef<number | undefined>(undefined);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [findBar, setFindBar] = useState(false);
  const [replaceRow, setReplaceRow] = useState(false);

  // ⌘F 查找 / ⌥⌘F 查找并替换;preventDefault 拦下 webview 原生查找。
  // 用 e.code 判断:macOS Option+F 的 e.key 是特殊字符(ƒ),code 不受影响
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift 交给专注模式(⌘⇧F,App 层处理),这里必须排除,否则两个一起触发
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.code !== "KeyF") return;
      e.preventDefault();
      setFindBar(true);
      if (e.altKey) setReplaceRow(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const editor = useEditor({
    // SlashMenu / WikiLinkSuggest / FindReplace 是 UI 交互插件不贡献 Schema,单独挂载(baseExtensions 保持纯 Schema 集合)
    extensions: [
      ...baseExtensions,
      SlashMenuExtension,
      WikiLinkSuggestExtension.configure({ getDocs: () => wikiDocsRef.current?.() ?? [] }),
      FindReplaceExtension,
    ],
    // HTML 字符串:编辑器内部 DOMParser 与 markdownToDoc 同一条路径(parse.ts)
    content: mdToHtml(markdown),
    editorProps: {
      attributes: { class: "yz-editor-doc" },
      // 外部文件拖拽必须先取消 dragover,目标才是合法落点;否则松手时
      // WebKit 走默认动作「打开文件」= 整窗导航到图片(PM 不替你取消,只管内部节点拖动)
      handleDOMEvents: {
        dragover: (_view, event) => {
          const e = event as DragEvent;
          if (e.dataTransfer?.types?.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
          return false; // 内部拖动(文本/树节点)继续走 PM 自己的 dragover 处理
        },
      },
      // 粘贴清洗(PRD §5.7):微信/网页/Word HTML 先洗干净再进 schema
      transformPastedHTML: cleanPastedHtml,
      // 剪贴板里有图片文件 → 直接走 assets 落盘(5.3.7),不吃 HTML 清洗路径
      handlePaste: (_view, event) => {
        const files = imageFilesOf(event.clipboardData?.files);
        if (!files.length || !imageFilesRef.current) return false;
        event.preventDefault();
        void imageFilesRef.current(files);
        return true;
      },
      // 拖入图片文件(moved=true 是编辑器内部拖动文本,不拦)
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFilesOf(event.dataTransfer?.files);
        // DEV 诊断:真机拖拽排查用(文件是否送达 JS / 有无 MIME)
        if (import.meta.env.DEV) {
          const dt = event.dataTransfer;
          console.log(
            "[editor] drop:",
            dt?.types && Array.from(dt.types).join(","),
            `files=${dt?.files?.length ?? 0}`,
            files.map((f) => `${f.name}:${f.type || "no-mime"}`).join(" | "),
          );
        }
        if (!files.length || !imageFilesRef.current) return false;
        event.preventDefault();
        // PM 捕获阶段在此接住即停传播:窗口级兜底(App)就不会重复插入
        event.stopPropagation();
        void imageFilesRef.current(files);
        return true;
      },
      // 单击双链跳转(语雀式);放光标可用键盘/拖选进入链接文本
      handleClick: (view, pos) => {
        const mark = view.state.doc
          .resolve(pos)
          .marks()
          .find((m) => m.type.name === "wikiLink");
        if (!mark) return false;
        openWikiRef.current?.(String(mark.attrs.target ?? ""));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        onChangeRef.current?.(docToMarkdown(editor.state.doc));
      }, CHANGE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  // 斜杠菜单「图片」:模块级回调注册(菜单 COMMANDS 拿不到 props)
  useEffect(() => {
    setSlashImagePicker((ed) => {
      void pickImageRef.current?.().then((srcs) => {
        if (srcs) for (const src of srcs) insertImage(ed, { src });
      });
    });
    return () => setSlashImagePicker(null);
  }, []);

  // 斜杠菜单「附件」+ 附件卡点击打开(同上,模块级注入)
  useEffect(() => {
    setSlashAttachmentPicker((ed) => {
      void pickAttachmentRef.current?.().then((items) => {
        if (!items) return;
        for (const it of items) {
          ed.chain()
            .focus()
            .insertContent({ type: "attachment", attrs: { name: it.name, href: it.href } })
            .run();
        }
      });
    });
    setAttachmentOpener((href) => openAttachmentRef.current?.(href));
    return () => {
      setSlashAttachmentPicker(null);
      setAttachmentOpener(null);
    };
  }, []);

  // 全局搜索定位:文档载入完成后跳首个命中 + 高亮 + 打开查找条
  const lastLocateSeq = useRef(-1);
  useEffect(() => {
    if (!editor || !locateSignal || locateSignal.seq === lastLocateSeq.current) return;
    lastLocateSeq.current = locateSignal.seq;
    setFindBar(true);
    setReplaceRow(false);
    setSearch(editor, locateSignal.term);
  }, [editor, locateSignal]);

  // 外部内容切换(知识库 openDoc):markdown prop 变化 → 重载编辑器。
  // setContent 默认 emitUpdate:false,不会回灌 onMarkdownChange;同时收起查找条。
  // 派发挪进微任务:setContent 挂载 React NodeView(代码块/图片卡片)时 Tiptap
  // 内部走 flushSync,effect 里同步调会触发 React「lifecycle 里 flushSync」警告
  const lastLoadedRef = useRef(markdown);
  useEffect(() => {
    if (!editor || markdown === lastLoadedRef.current) return;
    lastLoadedRef.current = markdown;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      setFindBar(false);
      closeFind(editor);
      editor.commands.setContent(mdToHtml(markdown));
    });
  }, [editor, markdown]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col${cardBorder ? "" : " yz-flat-cards"}`}>
      {editor && showToolbar && <EditorToolbar editor={editor} />}
      {editor && findBar && (
        <FindReplaceBar
          editor={editor}
          showReplace={replaceRow}
          onToggleReplace={() => setReplaceRow((v) => !v)}
          onClose={() => setFindBar(false)}
        />
      )}
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {/* relative 是 TableToolbar/ImageToolbar 浮层的定位锚 */}
        <div className="relative mx-auto max-w-3xl px-16 py-12">
          <EditorContent editor={editor} />
          {editor && <TableToolbar editor={editor} />}
          {editor && <ImageToolbar editor={editor} onPreview={setPreviewSrc} />}
        </div>
      </div>
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  );
}
