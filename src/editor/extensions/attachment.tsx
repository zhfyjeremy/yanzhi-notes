import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  File,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";

/**
 * 附件卡片 Attachment(PRD 6.1.5):`[文件名](./assets/xx.ext)` 标准链接的渲染增强。
 * §10 无附件专用方言——存储就是标准 Markdown 链接,只有「独立段落 + 单链接 +
 * assets 相对路径」才解析成卡片(解析见 md-instance.ts yz_attachment);
 * 行内混排链接不受影响。点击卡片唤起系统打开文件(应用层解析库内路径)。
 */

/** 点击唤起系统打开;由 YanzhiEditor 注入应用层回调(模块级,NodeView 拿不到 props) */
type AttachmentOpener = (href: string) => void;
let opener: AttachmentOpener | null = null;

export function setAttachmentOpener(fn: AttachmentOpener | null): void {
  opener = fn;
}

/** 按扩展名挑卡片图标(大类区分即可,不追求逐格式) */
function iconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf", "md", "markdown", "txt", "doc", "docx"].includes(ext)) return FileText;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["mp3", "wav", "m4a", "flac"].includes(ext)) return FileAudio;
  if (["mp4", "mov", "avi", "mkv"].includes(ext)) return FileVideo;
  return File;
}

function AttachmentView({ node, selected }: NodeViewProps) {
  const href = String(node.attrs.href ?? "");
  const name = String(node.attrs.name ?? "");
  const Icon = iconFor(name);
  return (
    <NodeViewWrapper className="yz-attachment" data-selected={selected || undefined}>
      {/* 点击 = 唤起系统打开(6.1.5);名称不可在卡内编辑,改名 = 删除重插。
          title 提供长文件名的完整内容(截断类提示保留原生 title) */}
      <button
        type="button"
        className="yz-attachment-btn"
        title={`打开 ${name}`}
        contentEditable={false}
        onClick={(e) => {
          // 阻止 PM 把点击当成选区/光标操作
          e.stopPropagation();
          opener?.(href);
        }}
      >
        <Icon className="yz-attachment-icon" />
        <span className="yz-attachment-name">{name}</span>
      </button>
    </NodeViewWrapper>
  );
}

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      href: { default: "" },
      name: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-attachment]",
        getAttrs: (element) => ({
          href: element.getAttribute("data-href") ?? "",
          name: element.getAttribute("data-name") ?? "",
        }),
      },
    ];
  },

  renderHTML({ node }) {
    // 导出 HTML / 复制富文本 = 标准链接形态(§10 无专用方言)
    return ["a", { href: String(node.attrs.href ?? "") }, String(node.attrs.name ?? "")];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
