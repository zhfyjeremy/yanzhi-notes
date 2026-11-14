import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  Bold,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Code2,
  FileCode,
  FileText,
  Highlighter,
  ImageIcon,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Scissors,
  Share2,
  Sigma,
  Sparkles,
  Strikethrough,
  Table,
  Text,
  Workflow,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyPlainText, copyRichText } from "../clipboard";
import { markdownForRange } from "../copy-markdown";
import {
  AI_GROUP_LABEL,
  LANG_OPTIONS,
  MATH_OPTIONS,
  TONE_OPTIONS,
  visibleAiActions,
  type AiActionId,
} from "@/ai/actions";
import type { AiSession } from "@/ai/useAiSession";
import { isTauriEnv } from "@/kb/backend";
import { pickSlashImage } from "../slash-command";

/**
 * 文档右键菜单(统一入口):
 * 之前右键只有 AI 菜单(且仅 AI 开启时),其余情况落到浏览器默认菜单 ——
 * 本组件接管后 **永远拦掉默认菜单**,给一套完整、贴合写作流的操作。
 *
 * 分组:剪贴板 / 格式 / 插入 / AI 助手 / 文档。
 * 表格单元格的右键仍走表格菜单(它在里层,先 preventDefault → 本菜单不弹)。
 *
 * 交互约定:右键落点即作用点(像表格菜单那样把光标挪到落点);
 * 落在既有选区内则保留选区。AI 动作作用于右键瞬间的选区。
 */

interface EditorContextMenuProps {
  editor: Editor;
  /** AI 会话;未配置时 AI 分组给「去配置」入口 */
  aiSession?: AiSession | null;
  aiReady: boolean;
  onNeedAiSettings?: () => void;
  /** 导出当前文档(Markdown / 离线 HTML) */
  onExportMd?: () => void;
  onExportHtml?: () => void;
  onExportDocx?: () => void;
  children: ReactNode;
}

type CtxRange = { from: number; to: number };

/** 读剪贴板纯文本(tauri 走原生插件,浏览器走 navigator) */
async function readClipboardText(): Promise<string | null> {
  try {
    if (isTauriEnv()) {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      return await readText();
    }
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/** 范围 HTML(富文本复制用;空范围给全文) */
function rangeHtml(editor: Editor, from: number, to: number): string {
  if (from === to) return editor.getHTML();
  const slice = editor.state.doc.slice(from, to);
  const frag = DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content);
  const box = document.createElement("div");
  box.appendChild(frag);
  return box.innerHTML;
}

export function EditorContextMenu({
  editor,
  aiSession,
  aiReady,
  onNeedAiSettings,
  onExportMd,
  onExportHtml,
  onExportDocx,
  children,
}: EditorContextMenuProps) {
  /**
   * 右键瞬间锁定的「作用范围」:
   * 菜单弹出后浏览器会把 DOM 光标挪走(点菜单项时甚至挪到文末),
   * 实时选区不可信 → 右键时把范围存下来,菜单动作一律按它执行。
   */
  const [ctxTarget, setCtxTarget] = useState<CtxRange>({ from: 1, to: 1 });
  /**
   * 右键按下瞬间的选区:浏览器的右键 mousedown 可能先把选区收成光标,
   * 等 contextmenu 时就看不出"右键是否落在选区内" → 在 capture 阶段先记一份。
   */
  const mousedownSelRef = useRef<CtxRange | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const sel = editor.state.selection;
      mousedownSelRef.current = sel.from !== sel.to ? { from: sel.from, to: sel.to } : null;
    };
    dom.addEventListener("mousedown", onDown, true);
    return () => dom.removeEventListener("mousedown", onDown, true);
  }, [editor]);

  const onContextMenu = (event: React.MouseEvent) => {
    // 表格菜单(内层)已处理并 preventDefault → 本文菜单不介入
    if (event.defaultPrevented) return;
    const view = editor.view;
    let pos: number | null = null;
    // 落点取「光标所在块」而不是坐标最近字符:点在短行右侧空白时
    // posAtCoords 会落到相邻块,标题/列表会套错块。
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const block = hit?.closest?.("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th");
    if (block && view.dom.contains(block)) {
      try {
        // 落点取「点击处字符」,但夹在本块范围内:
        // 短行右侧空白处 posAtCoords 会落到相邻块,标题/列表会套错块
        const start = view.posAtDOM(block, 0);
        const end = view.posAtDOM(block, block.childNodes.length);
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? start;
        pos = Math.min(Math.max(at, start), end);
      } catch {
        pos = null;
      }
    }
    if (pos == null) {
      try {
        pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
      } catch {
        pos = null;
      }
    }
    const sel = editor.state.selection;
    const keep = mousedownSelRef.current; // 右键按下时的选区(可能已被浏览器收成光标)
    mousedownSelRef.current = null;
    const inSelection =
      keep != null && pos != null && pos >= keep.from && pos <= keep.to;
    if (inSelection && keep) {
      // 右键落在既有选区内 → 保留整段选区(格式类动作作用于整段)
      setCtxTarget(keep);
      return;
    }
    const live = sel.from !== sel.to && pos != null && pos >= sel.from && pos <= sel.to;
    if (live) {
      setCtxTarget({ from: sel.from, to: sel.to });
      return;
    }
    const from = pos ?? sel.from;
    try {
      editor.commands.setTextSelection(from);
    } catch {
      /* 位置解析失败就不动 */
    }
    setCtxTarget({ from, to: from });
  };

  const hasSelection = ctxTarget.from !== ctxTarget.to;
  /** 所有动作都按锁定范围执行(不依赖实时选区) */
  const act = () => editor.chain().focus().setTextSelection(ctxTarget);

  const copyAsPlain = () => {
    const { from, to } = ctxTarget;
    const text =
      from === to ? editor.state.doc.textContent : editor.state.doc.textBetween(from, to, "\n");
    void copyPlainText(text);
  };

  const copyAsMarkdown = () => {
    const { from, to } = ctxTarget;
    void copyPlainText(markdownForRange(editor.state.doc, editor.schema, from, to));
  };

  const copyAsHtml = () => {
    const { from, to } = ctxTarget;
    const plain =
      from === to ? editor.state.doc.textContent : editor.state.doc.textBetween(from, to, "\n");
    void copyRichText(rangeHtml(editor, from, to), plain);
  };

  const cutSelection = async () => {
    const { from, to } = ctxTarget;
    if (from === to) return;
    await copyPlainText(editor.state.doc.textBetween(from, to, "\n"));
    // 删除要按锁定范围(实时选区已被浏览器挪走)
    act().deleteSelection().run();
  };

  const pasteAsPlain = async () => {
    const text = await readClipboardText();
    if (!text) return;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    act()
      .insertContent(
        lines.map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        })),
      )
      .run();
  };

  const runAi = (id: AiActionId, option?: string) => {
    if (!aiReady || !aiSession) {
      onNeedAiSettings?.();
      return;
    }
    void aiSession.run(editor, id, option, hasSelection ? ctxTarget : undefined);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        {/* 剪贴板 */}
        <ContextMenuItem onSelect={copyAsMarkdown}>
          <Code2 />
          复制为 Markdown
        </ContextMenuItem>
        <ContextMenuItem onSelect={copyAsPlain}>
          <FileText />
          复制为纯文本
        </ContextMenuItem>
        <ContextMenuItem onSelect={copyAsHtml}>
          <FileCode />
          复制为 HTML
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onSelect={() => void cutSelection()}>
          <Scissors />
          剪切
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void pasteAsPlain()}>
          <ClipboardPaste />
          粘贴为纯文本
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/* 文本 / 段落格式 */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Text />
            格式
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[min(70vh,30rem)] min-w-40 overflow-y-auto">
            <ContextMenuItem onSelect={() => act().toggleBold().run()}>
              <Bold />
              加粗
              <span className="text-muted-foreground ml-auto text-[10px]">⌘B</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleItalic().run()}>
              <Italic />
              斜体
              <span className="text-muted-foreground ml-auto text-[10px]">⌘I</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleStrike().run()}>
              <Strikethrough />
              删除线
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleCode().run()}>
              <Code />
              行内代码
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleHighlight().run()}>
              <Highlighter />
              高亮
            </ContextMenuItem>
            <ContextMenuSeparator />
            {[1, 2, 3, 4, 5, 6].map((level) => (
              <ContextMenuItem
                key={level}
                onSelect={() =>
                  act().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()
                }
              >
                标题 {level}
                <span className="text-muted-foreground ml-auto text-[10px]">⌘/Ctrl+{level}</span>
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={() => act().setParagraph().run()}>正文</ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleBlockquote().run()}>
              <Quote />
              引用
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleBulletList().run()}>
              <List />
              无序列表
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleOrderedList().run()}>
              <ListOrdered />
              有序列表
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleTaskList().run()}>
              <ListTodo />
              待办列表
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* 插入 */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ClipboardCopy />
            插入
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[min(70vh,30rem)] min-w-40 overflow-y-auto">
            <ContextMenuItem onSelect={() => pickSlashImage(editor)}>
              <ImageIcon />
              图片
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
              <Table />
              表格
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().toggleCodeBlock().run()}>
              <Code2 />
              代码块
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().setMathInline().run()}>
              <Sigma />
              行内公式
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().setMathBlock().run()}>
              <Sigma />
              独立公式
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().setCallout({ type: "info" }).run()}>
              <Info />
              提示块
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().setDetails().run()}>
              <List />
              折叠块
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                act()
                  .insertContent({
                    type: "codeBlock",
                    attrs: { language: "mermaid" },
                    content: [{ type: "text", text: "flowchart TD\n  A[开始] --> B{条件满足?}\n  B -- 是 --> C[处理完成]\n  B -- 否 --> D[流程结束]" }],
                  })
                  .run()
              }
            >
              <Workflow />
              Mermaid 图表
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => act().setHorizontalRule().run()}>
              <Minus />
              分割线
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* AI 助手 */}
        {aiReady && aiSession ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Sparkles />
              AI 助手
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-[min(70vh,30rem)] min-w-40 overflow-y-auto">
              {(["write", "structure", "card"] as const).map((group) => {
                const items = visibleAiActions(editor, hasSelection).filter(
                  (a) => a.group === group,
                );
                if (!items.length) return null;
                return (
                  <div key={group}>
                    <ContextMenuLabel>{AI_GROUP_LABEL[group]}</ContextMenuLabel>
                    {items.map((a) =>
                      a.option ? (
                        <ContextMenuSub key={a.id}>
                          <ContextMenuSubTrigger>{a.label}</ContextMenuSubTrigger>
                          <ContextMenuSubContent>
                            {(a.option === "tone"
                              ? TONE_OPTIONS
                              : a.option === "lang"
                                ? LANG_OPTIONS
                                : MATH_OPTIONS
                            ).map((opt) => (
                              <ContextMenuItem
                                key={opt}
                                onSelect={() => runAi(a.id, opt)}
                              >
                                {opt}
                              </ContextMenuItem>
                            ))}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                      ) : (
                        <ContextMenuItem key={a.id} onSelect={() => runAi(a.id)}>
                          {a.label}
                        </ContextMenuItem>
                      ),
                    )}
                  </div>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem onSelect={() => onNeedAiSettings?.()}>
            <Sparkles />
            配置 AI 助手…
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* 文档:三种格式收进二级菜单,顶级菜单保持短 */}
        {(onExportMd || onExportHtml || onExportDocx) && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Share2 />
              导出
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {onExportMd && (
                <ContextMenuItem onSelect={onExportMd}>
                  <FileText />
                  导出 Markdown…
                </ContextMenuItem>
              )}
              {onExportHtml && (
                <ContextMenuItem onSelect={onExportHtml}>
                  <FileCode />
                  导出离线 HTML…
                </ContextMenuItem>
              )}
              {onExportDocx && (
                <ContextMenuItem onSelect={onExportDocx}>
                  <FileText />
                  导出 Word (.docx)…
                </ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
