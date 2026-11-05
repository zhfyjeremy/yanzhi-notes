export type DateTimeInsertKind =
  | "date"
  | "time"
  | "datetime"
  | "chineseDate"
  | "chineseDatetime"
  | "timeWithSeconds";

const two = (n: number) => String(n).padStart(2, "0");

/**
 * 斜杠菜单插入用日期/时间格式化。
 * 时间取本机当前时间与本机时区;插入后是普通静态文本,不自动更新。
 */
export function formatDateTime(kind: DateTimeInsertKind, now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const d = now.getDate();
  const hh = two(now.getHours());
  const mm = two(now.getMinutes());
  const ss = two(now.getSeconds());

  switch (kind) {
    case "date":
      return `${y}-${two(mo)}-${two(d)}`;
    case "time":
      return `${hh}:${mm}`;
    case "datetime":
      return `${y}-${two(mo)}-${two(d)} ${hh}:${mm}`;
    case "chineseDate":
      return `${y}年${mo}月${d}日`;
    case "chineseDatetime":
      return `${y}年${mo}月${d}日 ${hh}:${mm}`;
    case "timeWithSeconds":
      return `${hh}:${mm}:${ss}`;
  }
}
