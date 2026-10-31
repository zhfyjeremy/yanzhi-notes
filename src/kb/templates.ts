/**
 * 文档模板(7.5):模板 = `.yanzhi/templates/` 里的 .md,文件名即模板名。
 * 新建文档正文 = 模板原文,首行恰为 H1 时剥离——砚知文档标题由文件名承担
 * (9.2,标题输入框独立于正文),空白新建的正文不含 H1,模板建出的也要同构;
 * H2 及以下层级是模板正文骨架,原样保留。
 */

export function templateToContent(md: string): string {
  const m = /^# [^\n]*(?:\n|$)/.exec(md);
  if (!m) return md;
  // 剥离 H1 行 + 其后紧邻空行(模板常见「# 标题\n\n正文」形态)
  return md.slice(m[0].length).replace(/^\n+/, "");
}
