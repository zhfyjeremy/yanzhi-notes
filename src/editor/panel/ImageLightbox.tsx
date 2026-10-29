import { useEffect } from "react";

/** 图片全屏预览(PRD §5.3.7 点击放大):点击遮罩或 Esc 关闭 */
export function ImageLightbox({
  src,
  onClose,
}: {
  src: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, onClose]);

  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-10"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
        // 点图不关闭(便于看细节),关遮罩关闭
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
