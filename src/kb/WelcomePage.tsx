import { useMemo, useState } from "react";
import { ChevronRight, FileText, FolderOpen, FolderPlus } from "lucide-react";
import appIcon from "../../src-tauri/icons/icon.png";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 首启欢迎页(PRD 5.0.1):三种工作区动作保持同等权重。
 * 存储事实只做说明,不再做成卡片,避免与可点击动作混淆。
 */

interface WelcomePageProps {
  recent: string[];
  recentFiles?: string[];
  bootError: string | null;
  onPickCreate: () => Promise<
    | null
    | { kind: "cancelled" }
    | { kind: "not-empty" | "is-yanzhi"; root: string }
    | { kind: "error"; message: string }
  >;
  onForceCreate: (root: string) => Promise<string | null>;
  onPickOpen: () => Promise<"cancelled" | string | null>;
  onOpenRecent: (root: string) => Promise<string | null>;
  onPickSingleFile: () => Promise<string | null>;
  onOpenRecentFile?: (path: string) => Promise<string | null>;
}

function rootLabel(root: string) {
  const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function parentLabel(root: string) {
  const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) return root;
  return `/${parts.slice(0, -1).join("/")}`;
}

export function WelcomePage({
  recent,
  recentFiles = [],
  bootError,
  onPickCreate,
  onForceCreate,
  onPickOpen,
  onOpenRecent,
  onPickSingleFile,
  onOpenRecentFile,
}: WelcomePageProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ root: string; yanzhi: boolean } | null>(null);
  const recentItems = useMemo(
    () => recent.slice(0, 5).map((root) => ({ root, name: rootLabel(root), parent: parentLabel(root) })),
    [recent],
  );
  const recentFileItems = useMemo(
    () => recentFiles.slice(0, 5).map((path) => ({ path, name: rootLabel(path), parent: parentLabel(path) })),
    [recentFiles],
  );

  const handleCreate = async () => {
    setError(null);
    setPending(null);
    const result = await onPickCreate();
    if (!result || result.kind === "cancelled") return;
    if (result.kind === "not-empty") setPending({ root: result.root, yanzhi: false });
    else if (result.kind === "is-yanzhi") setPending({ root: result.root, yanzhi: true });
    else if (result.kind === "error") setError(result.message);
  };

  const handleOpen = async () => {
    setError(null);
    setPending(null);
    const err = await onPickOpen();
    if (err && err !== "cancelled") setError(err);
  };

  const openRecent = async (root: string) => {
    setError(null);
    const err = await onOpenRecent(root);
    if (err) setError(err);
  };
  const openSingle = async () => {
    setError(null);
    setPending(null);
    const err = await onPickSingleFile();
    if (err) setError(err);
  };

  return (
    <main className="bg-workspace text-foreground flex h-screen flex-col items-center justify-start overflow-y-auto p-6 sm:p-8">
      <div className="welcome-shell my-auto w-full max-w-5xl">
        <div className="border-border-subtle bg-editor mx-auto rounded-2xl border p-5 shadow-[0_18px_50px_-24px_color-mix(in_oklab,var(--foreground)_28%,transparent)] sm:p-8">
          <section className="welcome-rise flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
              <img
                src={appIcon}
                alt=""
                aria-hidden="true"
                className="welcome-icon size-16 shrink-0 rounded-2xl shadow-sm"
                width={64}
                height={64}
              />
                <div className="min-w-0">
                  <h1 className="text-[1.65rem] leading-tight font-semibold tracking-[-0.025em]">砚知</h1>
                  <p className="text-muted-foreground mt-1 text-xs">一方砚,存所知</p>
                </div>
              </div>
              <span className="border-border-subtle bg-raised/50 text-muted-foreground rounded-full border px-2.5 py-1 text-[10px] font-medium">
                本地离线 · 不上云
              </span>
            </div>

            <p className="text-muted-foreground mt-5 text-sm leading-6">
              选择一种方式开始。砚知既适合把一个本地文件夹沉淀为知识库,
              也适合直接编辑一个 Markdown 文件。
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <button
                type="button"
                className="welcome-action border-border-subtle bg-raised/65 hover:border-primary/30 hover:bg-raised focus-visible:ring-ring flex h-36 cursor-pointer flex-col items-start gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_color-mix(in_oklab,var(--foreground)_35%,transparent)]"
                onClick={handleCreate}
              >
                <span className="bg-selection text-primary flex size-9 items-center justify-center rounded-lg">
                  <FolderPlus className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">新建知识库</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px] leading-4">
                    选一个空文件夹,长期沉淀笔记
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="welcome-action border-border-subtle bg-raised/65 hover:border-primary/30 hover:bg-raised focus-visible:ring-ring flex h-36 cursor-pointer flex-col items-start gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_color-mix(in_oklab,var(--foreground)_35%,transparent)]"
                onClick={handleOpen}
              >
                <span className="bg-selection text-primary flex size-9 items-center justify-center rounded-lg">
                  <FolderOpen className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">打开知识库</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px] leading-4">
                    已有 Markdown 文件夹,直接继续使用
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="welcome-action border-border-subtle bg-raised/65 hover:border-primary/30 hover:bg-raised focus-visible:ring-ring flex h-36 cursor-pointer flex-col items-start gap-3 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_color-mix(in_oklab,var(--foreground)_35%,transparent)]"
                onClick={() => void openSingle()}
              >
                <span className="bg-selection text-primary flex size-9 items-center justify-center rounded-lg">
                  <FileText className="size-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium">打开 Markdown 文件</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px] leading-4">
                    直接编辑一个 .md,不创建知识库
                  </span>
                </span>
              </button>
            </div>

            <div
              role="note"
              aria-label="本地数据说明"
              className="welcome-note border-border-subtle text-muted-foreground mt-4 border-t pt-3 text-[11px] leading-5"
            >
              知识库只是一个本地文件夹 · 文档为标准 .md · 复制文件夹即可完成备份
            </div>

            {(bootError || error || pending) && (
              <div className="mt-4 space-y-2">
                {bootError && (
                  <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-xs">
                    {bootError}
                  </p>
                )}
                {error && (
                  <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-3 py-2 text-xs">
                    {error}
                  </p>
                )}
                {pending && (
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-xs",
                      pending.yanzhi ? "border-primary/25 bg-selection" : "border-border-subtle bg-hover/50",
                    )}
                  >
                    <p className={cn("font-medium", pending.yanzhi && "text-primary")}>
                      {pending.yanzhi
                        ? `「${pending.root}」已经是砚知知识库`
                        : `「${pending.root}」不是空文件夹`}
                    </p>
                    <p className="text-muted-foreground mt-1">
                      {pending.yanzhi
                        ? "检测到 .yanzhi,建议直接打开它。"
                        : "建议选择空文件夹,避免与其它资料混在一起。"}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <Button size="xs" variant="ghost" onClick={() => setPending(null)}>
                        重选
                      </Button>
                      <Button
                        size="xs"
                        onClick={async () => {
                          const err = pending.yanzhi
                            ? await onOpenRecent(pending.root)
                            : await onForceCreate(pending.root);
                          if (err) setError(err);
                          setPending(null);
                        }}
                      >
                        {pending.yanzhi ? "打开该知识库" : "仍要在此创建"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

        </div>

        {(recentItems.length > 0 || recentFileItems.length > 0) && (
          <section className="welcome-rise-delayed mx-auto mt-4 max-w-5xl">
            <div className="border-border-subtle bg-sidebar/75 rounded-2xl border p-3 shadow-[0_12px_34px_-24px_color-mix(in_oklab,var(--foreground)_24%,transparent)]">
              <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-1 pb-2.5">
                <p className="text-foreground/75 text-[11px] font-semibold tracking-[0.04em]">最近打开</p>
                <p className="text-muted-foreground/60 text-[10px]">本机记录</p>
              </div>

              {recentItems.length > 0 && (
                <section className="mt-3">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-muted-foreground/80 text-[10px] font-medium">知识库</p>
                    <p className="text-muted-foreground/45 text-[10px] tabular-nums">{recentItems.length} 个</p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {recentItems.map((item) => (
                      <button
                        key={item.root}
                        type="button"
                        title={item.root}
                        className="welcome-recent-card border-border-subtle bg-raised/45 hover:border-primary/25 hover:bg-raised focus-visible:ring-ring group flex h-16 cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all"
                        onClick={() => void openRecent(item.root)}
                      >
                        <span className="bg-selection text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <FolderOpen className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{item.name}</span>
                          <span className="text-muted-foreground block truncate text-[10px]">{item.parent}</span>
                        </span>
                        <ChevronRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {recentFileItems.length > 0 && (
                <section className={recentItems.length > 0 ? "mt-4" : "mt-3"}>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-muted-foreground/80 text-[10px] font-medium">Markdown 文件</p>
                    <p className="text-muted-foreground/45 text-[10px] tabular-nums">{recentFileItems.length} 个</p>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {recentFileItems.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        title={item.path}
                        className="welcome-recent-card border-border-subtle bg-raised/45 hover:border-primary/25 hover:bg-raised focus-visible:ring-ring group flex h-16 cursor-pointer items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all"
                        onClick={() => {
                          if (!onOpenRecentFile) return;
                          void onOpenRecentFile(item.path).then((err) => err && setError(err));
                        }}
                      >
                        <span className="bg-hover text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                          <FileText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{item.name}</span>
                          <span className="text-muted-foreground block truncate text-[10px]">{item.parent}</span>
                        </span>
                        <ChevronRight className="text-muted-foreground/50 group-hover:text-primary size-4 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
