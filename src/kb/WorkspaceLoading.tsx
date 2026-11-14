import { FileText, ListTree } from "lucide-react";

/**
 * 开库/首启装载态：树、上次文档和滚动位置是一个整体状态，未落定前不渲染
 * 默认空文档，避免“先出现未命名文档，再跳到上次文档”的闪变。
 */
export function WorkspaceLoading({ message = "正在打开知识库…" }: { message?: string }) {
  return (
    <main className="app-shell bg-workspace text-foreground h-screen">
      <div className="shell-main flex h-full gap-3 px-3 py-3">
        <aside
          aria-hidden="true"
          className="shell-panel border-border-subtle bg-sidebar hidden w-[248px] shrink-0 rounded-2xl border p-3 shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)] sm:block"
        >
          <div className="mb-3 flex h-8 items-center gap-2">
            <ListTree className="text-muted-foreground size-4" />
            <div className="bg-muted h-4 w-24 animate-pulse rounded-full" />
          </div>
          <div className="space-y-2">
            {[92, 78, 86, 64, 80].map((width) => (
              <div
                key={width}
                className="bg-muted/70 h-6 animate-pulse rounded-lg"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        </aside>

        <section
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="shell-panel border-border-subtle bg-editor flex min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border shadow-[0_14px_40px_-22px_color-mix(in_oklab,var(--foreground)_32%,transparent)]"
        >
          <div className="border-border-subtle bg-raised/70 text-muted-foreground flex size-11 items-center justify-center rounded-xl border">
            <FileText className="size-5" aria-hidden />
          </div>
          <div>
            <p className="text-foreground/85 text-sm font-medium">{message}</p>
            <p className="text-muted-foreground mt-1 text-xs">正在恢复目录、上次文档和阅读位置</p>
          </div>
          <div className="bg-muted relative h-1 w-44 overflow-hidden rounded-full">
            <div className="bg-primary absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full" />
          </div>
        </section>
      </div>
    </main>
  );
}
