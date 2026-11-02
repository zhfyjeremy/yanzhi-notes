import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { baseExtensions } from "./extensions";
import { mdToHtml } from "./markdown/md-instance";
import { docToMarkdown } from "./markdown/serialize";
import {
  SlashMenuExtension,
  setSlashAiHandler,
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
import { DEFAULT_SHORTCUTS, shortcutMatches, type ShortcutBindings } from "../shortcuts";
import { scrollCaretToTypewriterLine } from "./typewriter";
import { AiChrome } from "../ai/AiChrome";
import type { AiSession } from "../ai/useAiSession";
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
  /**
   * 打字机滚动(专注模式子项):输入/键盘移光标时保持光标在视口中线附近。
   * 由应用层在 focusMode && settings.typewriterMode 时打开。
   */
  typewriter?: boolean;
  /** V3 可自定义全局快捷键 */
  shortcuts?: ShortcutBindings;
  /** AI BYOK(§7.8):总开关开且测试通过后才挂浮动条/右键;/ai 经 session */
  aiReady?: boolean;
  aiSession?: AiSession | null;
  onNeedAiSettings?: () => void;
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
  typewriter = false,
  shortcuts = DEFAULT_SHORTCUTS,
  aiReady = false,
  aiSession = null,
  onNeedAiSettings,
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
  // editorProps 只在创建时定型,打字机开关/滚动容器用 ref 读最新值
  const typewriterRef = useRef(typewriter);
  typewriterRef.current = typewriter;
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const bindScrollRef = (el: HTMLDivElement | null) => {
    scrollElRef.current = el;
    scrollContainerRef?.(el);
  };
  const timerRef = useRef<number | undefined>(undefined);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [findBar, setFindBar] = useState(false);
  const [replaceRow, setReplaceRow] = useState(false);

  // ⌘F 查找 / ⌥⌘F 查找并替换;preventDefault 拦下 webview 原生查找。
  // 用 e.code 判断:macOS Option+F 的 e.key 是特殊字符(ƒ),code 不受影响
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutMatches(e, shortcuts.replace)) {
        e.preventDefault();
        setFindBar(true);
        setReplaceRow(true);
      } else if (shortcutMatches(e, shortcuts.find)) {
        e.preventDefault();
        setFindBar(true);
        setReplaceRow(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts.find, shortcuts.replace]);

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
      // 打字机:接管 PM 默认 scrollIntoView(键入/多数键盘命令会请求),鼠标拖选不走此路径
      handleScrollToSelection: (view) => {
        if (!typewriterRef.current) return false;
        const el = scrollElRef.current;
        if (!el) return false;
        scrollCaretToTypewriterLine(view, el);
        return true;
      },
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

  /** 空白文档只有一行时,点击正文下方留白应聚焦末尾;正文/链接/按钮仍交给 PM 默认处理 */
  const focusEditorFromBlankArea = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !editor || editor.isDestroyed) return;
    const target = event.target as HTMLElement;
    if (target.closest(".yz-editor-doc, a, button, input, textarea, select")) return;
    event.preventDefault();
    editor.commands.focus("end");
  };

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

  // 斜杠 AI:未开开关 → 引导设置;续写允许空选区
  useEffect(() => {
    if (!aiSession) {
      setSlashAiHandler(null);
      return;
    }
    setSlashAiHandler((ed, actionId) => {
      if (!aiReady) {
        onNeedAiSettings?.();
        return;
      }
      void aiSession.run(ed, actionId);
    });
    return () => setSlashAiHandler(null);
  }, [aiSession, aiReady, onNeedAiSettings]);

  // 全局搜索定位:文档载入完成后跳首个命中 + 高亮 + 打开查找条
  const lastLocateSeq = useRef(-1);
  useEffect(() => {
    if (!editor || !locateSignal || locateSignal.seq === lastLocateSeq.current) return;
    lastLocateSeq.current = locateSignal.seq;
    setFindBar(true);
    setReplaceRow(false);
    setSearch(editor, locateSignal.term);
  }, [editor, locateSignal]);

  // 开启打字机(含专注切入)后补一次居中;等 padding 类生效后再滚
  useEffect(() => {
    if (!editor || editor.isDestroyed || !typewriter) return;
    const id = window.requestAnimationFrame(() => {
      const el = scrollElRef.current;
      if (el && !editor.isDestroyed) scrollCaretToTypewriterLine(editor.view, el);
    });
    return () => window.cancelAnimationFrame(id);
  }, [editor, typewriter]);

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
        ref={bindScrollRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
      >
        {/* relative 是 TableToolbar/ImageToolbar/AiChrome 浮层的定位锚;
            打字机加大上下留白,首行/文末也能滚到视口中线 */}
        <div
          className={`relative mx-auto flex w-full max-w-3xl flex-1 flex-col px-16 ${
            typewriter ? "pt-[42vh] pb-[58vh]" : "pt-10 pb-24"
          }`}
          onMouseDown={focusEditorFromBlankArea}
        >
          <EditorContent editor={editor} className="flex flex-1 flex-col" />
          {editor && <TableToolbar editor={editor} />}
          {editor && <ImageToolbar editor={editor} onPreview={setPreviewSrc} />}
          {editor && aiSession && aiReady && (
            <AiChrome
              editor={editor}
              session={aiSession}
              enabled={aiReady}
              onNeedSettings={() => onNeedAiSettings?.()}
            />
          )}
        </div>
      </div>
      <ImageLightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  );
}
