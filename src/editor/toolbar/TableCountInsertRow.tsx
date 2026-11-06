import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/** 批量插入上限,与 table-utils.insertTableAxis 一致 */
export const TABLE_BATCH_MAX = 50;

/** 把草稿规范到 1–50;空/非法 → 1 */
export function clampBatchCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(TABLE_BATCH_MAX, Math.max(1, n));
}

/**
 * 表格「在上方/下方插入行」一类操作行:
 * 标签 + 数量框(默认可手输 1–50) + 勾选确认。工具条下拉与单元格右键共用。
 */
export function TableCountInsertRow({
  label,
  onCommit,
}: {
  label: string;
  onCommit: (count: number) => void;
}) {
  const [count, setCount] = useState("1");

  const commit = () => {
    const n = clampBatchCount(count);
    setCount(String(n));
    onCommit(n);
  };

  const step = (delta: number) => {
    setCount(String(clampBatchCount(String(clampBatchCount(count) + delta))));
  };

  return (
    <div
      className="hover:bg-hover focus-within:bg-hover flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
      onPointerDown={(e) => {
        // 输入框必须能聚焦才能手输;对其它区域 preventDefault 防止 radix 菜单抢焦点关掉
        if ((e.target as HTMLElement).closest("input")) return;
        e.preventDefault();
      }}
    >
      <span className="text-foreground min-w-0 flex-1 truncate text-[12px]">{label}</span>
      <div className="border-border-subtle bg-raised focus-within:border-foreground relative flex h-6 w-12 shrink-0 overflow-hidden rounded border">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          aria-label={`${label}数量,1 到 ${TABLE_BATCH_MAX}`}
          title={`1–${TABLE_BATCH_MAX}`}
          value={count}
          onPointerDown={(e) => {
            // 阻断冒泡到菜单,同时保留默认聚焦
            e.stopPropagation();
          }}
          onChange={(e) => {
            // 允许清空再手输;只留数字
            const next = e.target.value.replace(/\D/g, "").slice(0, 2);
            setCount(next);
          }}
          onBlur={() => setCount(String(clampBatchCount(count)))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className="h-full w-full bg-transparent pr-3 pl-1 text-center text-[12px] outline-none"
        />
        <div className="border-border-subtle absolute top-0 right-0 flex h-full w-3 flex-col border-l">
          <button
            type="button"
            tabIndex={-1}
            aria-label="增加"
            className="text-muted-foreground hover:text-foreground hover:bg-hover flex flex-1 items-center justify-center"
            onClick={() => step(1)}
          >
            <ChevronDown className="size-2.5 rotate-180" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="减少"
            className="text-muted-foreground hover:text-foreground hover:bg-hover border-border-subtle flex flex-1 items-center justify-center border-t"
            onClick={() => step(-1)}
          >
            <ChevronDown className="size-2.5" />
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="确认插入"
        className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-6 shrink-0 items-center justify-center rounded"
        onClick={commit}
      >
        <Check className="size-3.5" />
      </button>
    </div>
  );
}
