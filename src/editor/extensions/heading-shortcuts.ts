import { Extension } from "@tiptap/core";

/**
 * 标题快捷键:Ctrl+1–6 始终可用;同时保留平台惯例 ⌘+1–6(macOS 上 Mod=⌘,
 * Windows 上与 Ctrl 等价)。按当前层级再次按下会回到正文,与 toggleHeading 语义一致。
 */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const HeadingShortcuts = Extension.create({
  name: "headingShortcuts",

  addKeyboardShortcuts() {
    return Object.fromEntries(
      HEADING_LEVELS.flatMap((level) => {
        const run = () => this.editor.commands.toggleHeading({ level });
        return [
          [`Control-${level}`, run],
          [`Mod-${level}`, run],
          [`Meta-${level}`, run],
        ];
      }),
    );
  },
});
