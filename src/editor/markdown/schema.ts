import { Editor } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { baseExtensions } from "../extensions";

let cached: Schema | null = null;

/** headless 获取统一 Schema(测试与无 UI 场景共用同一套扩展) */
export function getSchema(): Schema {
  if (!cached) {
    const editor = new Editor({ extensions: baseExtensions });
    cached = editor.state.schema;
    editor.destroy();
  }
  return cached;
}
