/**
 * 系统原生对话框(选文件/文件夹/另存为)全局互斥。
 * Windows 上 WebView2 + 多次 invoke 会叠出多个对话框;macOS 同样受益但不改变行为语义
 * (忙碌时视为用户取消,返回 undefined,由调用方按「取消」处理)。
 */
let busy = false;

export async function withNativeDialog<T>(run: () => Promise<T>): Promise<T | undefined> {
  if (busy) return undefined;
  busy = true;
  try {
    return await run();
  } finally {
    busy = false;
  }
}
