"use client";

import { useMemo } from "react";
import { JsonView, collapseAllNested } from "react-json-view-lite";

type JsonViewerProps = {
  value: unknown;
  emptyText?: string;
};

function isJsonContainer(
  value: unknown
): value is Record<string, unknown> | Array<unknown> {
  return typeof value === "object" && value !== null;
}

export function JsonViewer({ value, emptyText = "-" }: JsonViewerProps) {
  const normalized = useMemo(() => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return { kind: "text" as const, text: emptyText };
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (isJsonContainer(parsed)) {
          return { kind: "json" as const, data: parsed };
        }
        return { kind: "text" as const, text: JSON.stringify(parsed) };
      } catch {
        return { kind: "text" as const, text: value };
      }
    }

    if (isJsonContainer(value)) {
      return { kind: "json" as const, data: value };
    }

    if (value === null || typeof value === "undefined") {
      return { kind: "text" as const, text: emptyText };
    }

    return { kind: "text" as const, text: String(value) };
  }, [value, emptyText]);

  return normalized.kind === "json" ? (
    <div className="tc-json-viewer">
      <JsonView
        data={normalized.data}
        shouldExpandNode={collapseAllNested}
        clickToExpandNode
        aria-label="JSON 日志内容"
      />
    </div>
  ) : (
    <pre className="tc-json-fallback">{normalized.text}</pre>
  );
}
