import { Extension } from "@tiptap/core";

/**
 * 标题快捷键:Ctrl+1–6 始终可用;同时保留平台惯例 ⌘+1–6(macOS 上 Mod=⌘,
 * Windows 上与 Ctrl 等价)。按当前层级再次按下会回到正文,与 toggleHeading 语义一致。
 * 标题态下普通 Enter 也退出到正文,避免 `# ` 后连续写作一直继承 heading。
 */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const HeadingShortcuts = Extension.create({
  name: "headingShortcuts",

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        const $from = selection.$anchor;
        if ($from.parent.type.name !== "heading" || !selection.empty) return false;

        const atStart = $from.parentOffset === 0;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        // 空标题:原地转正文,避免再拆出一个空行。
        if (atStart && atEnd) return this.editor.commands.setParagraph();

        // 标题开头:先转正文再拆行,插入的空行也不会继承 heading。
        if (atStart) {
          return this.editor.chain().setParagraph().splitBlock().run();
        }

        // 标题末尾:splitBlock 在此处新建的块已按父级默认块(正文)落地,不必再 setParagraph。
        // 多调一次 setParagraph 会返回 false(目标已是 paragraph,setBlockType 判为「无需变更」),
        // chain.run() 因此判失败、事件继续冒泡给 Tiptap 核心 keymap 的 Enter → 再拆一次,多出一行空段。
        if (atEnd) return this.editor.commands.splitBlock();

        // 标题中间:拆行后把光标所在的新块落回正文(此时新块仍是 heading,setParagraph 可用)。
        return this.editor.chain().splitBlock().setParagraph().run();
      },
      ...Object.fromEntries(
        HEADING_LEVELS.flatMap((level) => {
          const run = () => this.editor.commands.toggleHeading({ level });
          return [
            [`Control-${level}`, run],
            [`Mod-${level}`, run],
            [`Meta-${level}`, run],
          ];
        }),
      ),
    };
  },
});
