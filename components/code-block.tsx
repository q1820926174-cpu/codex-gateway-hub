"use client";

import type { CSSProperties } from "react";

type CodeBlockProps = {
  value: string;
  language?: string;
  emptyText?: string;
  maxHeight?: number | string;
};

export function CodeBlock({
  value,
  language,
  emptyText = "-",
  maxHeight = 220
}: CodeBlockProps) {
  const content = value.trim() ? value : emptyText;
  const style = {
    "--tc-code-block-max-height":
      typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight
  } as CSSProperties;

  return (
    <div className="tc-code-block" style={style}>
      {language ? (
        <div className="tc-code-block-head">
          <span className="tc-code-block-language">{language}</span>
        </div>
      ) : null}
      <pre className="tc-code-block-body">
        <code>{content}</code>
      </pre>
    </div>
  );
}
