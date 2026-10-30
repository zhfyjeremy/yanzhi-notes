import { useState } from "react";
import { FolderOpen, FolderPlus, Vault } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 首启欢迎页(PRD 5.0.1):必须让用户理解「知识库 = 本机一个文件夹」,
 * 不自动建库、不静默写盘。新建/打开同等权重;最近打开次之。
 */

interface WelcomePageProps {
  recent: string[];
  bootError: string | null;
  onPickCreate: () => Promise<null | { kind: "not-empty"; root: string } | { kind: "error"; message: string }>;
  onForceCreate: (root: string) => Promise<string | null>;
  onPickOpen: () => Promise<string | null>;
  onOpenRecent: (root: string) => Promise<string | null>;
}

export function WelcomePage({
  recent,
  bootError,
  onPickCreate,
  onForceCreate,
  onPickOpen,
  onOpenRecent,
}: WelcomePageProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null); // 非空目录待确认

  const handleCreate = async () => {
    setError(null);
    setPendingRoot(null);
    const result = await onPickCreate();
    if (result?.kind === "not-empty") {
      setPendingRoot(result.root);
    } else if (result?.kind === "error") {
      setError(result.message);
    }
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center">
      <div className="w-full max-w-xl px-8">
        <div className="mb-10 flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-xl">
            <Vault className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">砚知</h1>
            <p className="text-muted-foreground text-sm">
              把笔记存在你电脑上的文件夹里,不上云、无账号
            </p>
          </div>
        </div>

        <div className="bg-muted/40 rounded-lg p-5 text-sm leading-6">
          <p className="mb-2 font-medium">什么是知识库?</p>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            <li>知识库 = 你指定的一个本地文件夹</li>
            <li>里面的 <code className="bg-muted rounded px-1">.md</code> 就是文档,可以用别的编辑器打开</li>
            <li>复制整个文件夹 = 备份 / 换电脑带走</li>
          </ul>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <Button size="lg" variant="outline" className="h-20 flex-col gap-2" onClick={handleCreate}>
            <FolderPlus className="size-5" />
            <span>
              新建知识库
              <span className="text-muted-foreground ml-1 text-xs">适合第一次用</span>
            </span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-20 flex-col gap-2"
            onClick={async () => {
              setError(null);
              const err = await onPickOpen();
              if (err) setError(err);
            }}
          >
            <FolderOpen className="size-5" />
            <span>
              打开已有文件夹
              <span className="text-muted-foreground ml-1 text-xs">已有 Markdown 目录</span>
            </span>
          </Button>
        </div>

        {bootError && <p className="text-destructive mt-6 text-sm">{bootError}</p>}
        {error && <p className="text-destructive mt-6 text-sm">{error}</p>}
        {pendingRoot && (
          <div className="bg-muted/60 mt-6 rounded-lg p-4 text-sm">
            <p className="mb-3">
              「{pendingRoot}」不是空文件夹。建议选空文件夹,避免与其它资料混在一起。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPendingRoot(null)}>
                重选
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const err = await onForceCreate(pendingRoot);
                  if (err) setError(err);
                  setPendingRoot(null);
                }}
              >
                仍要在此创建
              </Button>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-10">
            <p className="text-muted-foreground mb-2 text-xs">最近打开</p>
            <div className="space-y-1">
              {recent.slice(0, 5).map((root) => (
                <button
                  key={root}
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  onClick={async () => {
                    setError(null);
                    const err = await onOpenRecent(root);
                    if (err) setError(err);
                  }}
                >
                  <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{root}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
