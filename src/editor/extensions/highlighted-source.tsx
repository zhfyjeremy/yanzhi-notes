import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { highlightHtmlSource, type HighlightToken } from "./code-highlight";

/**
 * 带语法高亮的源码编辑框(透明 textarea 叠在高亮层上)。
 *
 * Raw HTML 块的「源码态」用它:上层 textarea 负责输入/选区/光标,
 * 下层 pre 负责着色。两层文字必须逐字对齐,所以字体、行高、内边距、
 * 换行规则全部由同一组 CSS 驱动(.yz-highlight-source-*),并同步滚动。
 *
 * 高亮不可用时(Shiki 未就绪 / 解析失败)退回纯文本 textarea,不阻塞编辑。
 */
export function HighlightedSourceArea({
  value,
  onChange,
  onBlur,
  onKeyDown,
  ariaLabel,
  className,
  inputClassName,
  minRows,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  ariaLabel: string;
  /** 外层容器 class(边框/底色) */
  className?: string;
  /** textarea 自身的 class */
  inputClassName?: string;
  minRows: number;
  /** 暴露内部 textarea:调用方需要聚焦并设置光标位置 */
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  /**
   * 三态:null = 还没出结果(纯文本可见,避免透明 textarea 露出空框);
   * [] = 高亮不可用(纯文本可见);非空 = 高亮片段(文字透明,靠下层着色)。
   */
  const [tokenLines, setTokenLines] = useState<HighlightToken[][] | null>(null);
  const inputRef = textareaRef ?? ownRef;
  // 高亮是异步的(Shiki 懒加载 html grammar);值变化时重算
  useEffect(() => {
    let alive = true;
    void highlightHtmlSource(value).then(
      (result) => {
        if (alive) setTokenLines(result);
      },
      () => {
        // grammar 加载/解析失败时不阻塞编辑,退回纯文本
        if (alive) setTokenLines([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [value]);

  // 滚动同步:textarea 滚动时把 pre 一起挪
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    const pre = preRef.current;
    if (!textarea || !pre) return;
    const sync = () => {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
    };
    sync();
    textarea.addEventListener("scroll", sync);
    return () => textarea.removeEventListener("scroll", sync);
  }, [tokenLines, inputRef]);

  const rows = Math.max(minRows, Math.min(20, value.split("\n").length));
  /** 有高亮层时 textarea 文字透明,由下层着色 */
  const highlighted = tokenLines !== null && tokenLines.length > 0;

  return (
    <div
      className={`yz-highlight-source ${className ?? ""} ${
        highlighted ? "yz-highlight-source-on" : ""
      }`}
    >
      {highlighted ? (
        <pre className="yz-highlight-source-layer" ref={preRef} aria-hidden="true">
          <code>
            {tokenLines!.map((line, lineIndex) => (
              <span key={lineIndex}>
                {/* Shiki 按行返回 token,换行符不在 token 里;这里补回去才能与 textarea 对齐 */}
                {lineIndex > 0 ? "\n" : null}
                {line.map((token, index) =>
                  token.cls ? (
                    <span key={index} className={`yz-tok-${token.cls}`}>
                      {token.content}
                    </span>
                  ) : (
                    <span key={index}>{token.content}</span>
                  ),
                )}
              </span>
            ))}
          </code>
        </pre>
      ) : null}
      <textarea
        ref={inputRef}
        className={`yz-highlight-source-input ${inputClassName ?? ""}`}
        value={value}
        spellCheck={false}
        aria-label={ariaLabel}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
