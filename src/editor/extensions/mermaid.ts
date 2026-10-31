import type { Mermaid } from "mermaid";

/**
 * Mermaid 渲染运行时(PRD §6.1.4/§12.7):动态 import 懒加载
 * (约 1MB,不进主 bundle)、全离线(打包产物,禁 CDN)、串行渲染
 * (mermaid 内部是全局单例,并发 render 会互相踩)。
 * 存储侧零方言:```mermaid 围栏就是 codeBlock(language=mermaid),
 * 解析/序列化走既有 codeBlock 路径,本文件只负责 NodeView 的渲染。
 */

let mermaidPromise: Promise<Mermaid> | null = null;
/** 上次 initialize 时的暗色态(null = 尚未初始化);UI 暗色 → mermaid 'dark',亮色 → 'neutral' */
let currentDark: boolean | null = null;
/** 渲染序列号:唯一 svg id + 并发观察 */
let seq = 0;
/** 串行队列:上一任务(含失败)落定后才跑下一个 */
let queue: Promise<unknown> = Promise.resolve();

export function isDarkMode(): boolean {
  return typeof document !== "undefined"
    ? document.documentElement.classList.contains("dark")
    : false;
}

async function getMermaid(): Promise<Mermaid> {
  const dark = isDarkMode();
  if (!mermaidPromise || dark !== currentDark) {
    const promise = mermaidPromise ?? import("mermaid").then((m) => m.default);
    mermaidPromise = promise;
    const mermaid = await promise;
    // initialize 可重复调用;主题切换时重设(浅 neutral / 深 dark,跟随 design token 体系)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "neutral",
    });
    currentDark = dark;
  }
  return mermaidPromise;
}

/** 渲染 mermaid 源码为 svg 字符串;语法错误抛异常(调用方决定展示形态) */
export function renderMermaid(code: string): Promise<string> {
  seq += 1;
  const id = `yz-mmd-${seq}`;
  const job = queue.then(async () => {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(id, code);
    return svg;
  });
  // 失败不堵队列;job 本身向上抛
  queue = job.catch(() => undefined);
  return job;
}
