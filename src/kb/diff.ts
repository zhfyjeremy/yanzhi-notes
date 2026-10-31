/**
 * 行级 diff(6.2-4 快照对比视图):公共前后缀裁剪 + LCS 中段 + 规模兜底。
 * 无第三方依赖(技术栈锁定),笔记量级下中段很小;极端超大对拍退化为
 * 整段删+加,保证可用不卡死。
 */

export type DiffRowType = "ctx" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  text: string;
}

/** LCS DP 表规模上限(单元格数);超出走兜底分支 */
const MAX_CELLS = 1_000_000;

export function diffLines(oldText: string, newText: string): DiffRow[] {
  // 空串 = 零行(split 会给出 [""] 的假空行)
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  // 公共前后缀裁剪:笔记编辑几乎都是局部改动,LCS 只算中段
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
    suf++;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < pre; i++) rows.push({ type: "ctx", text: a[i] });
  rows.push(...lcsDiff(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf)));
  for (let i = a.length - suf; i < a.length; i++) rows.push({ type: "ctx", text: a[i] });
  return rows;
}

function lcsDiff(a: string[], b: string[]): DiffRow[] {
  if (a.length === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (b.length === 0) return a.map((text) => ({ type: "del" as const, text }));
  if (a.length * b.length > MAX_CELLS) {
    // 兜底:中段整删+整加(不追最优编辑脚本,信息不丢)
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度;回溯需要全程表
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.min(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] <= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}
