import type { MouseEventHandler } from "react";

export type ActiveFilterItem = {
  key: string;
  label: string;
  value: string;
  tone?: "primary" | "warning" | "success" | "default";
  onClear?: () => void;
};

type ActiveFilterSummaryProps = {
  items: ActiveFilterItem[];
  onClearAll?: () => void;
};

export function ActiveFilterSummary({ items, onClearAll }: ActiveFilterSummaryProps) {
  if (items.length === 0) {
    return null;
  }

  const toneClass = (tone: ActiveFilterItem["tone"]) => {
    switch (tone) {
      case "primary":
        return "tc-filter-chip-primary";
      case "warning":
        return "tc-filter-chip-warning";
      case "success":
        return "tc-filter-chip-success";
      default:
        return "";
    }
  };

  const handleClear = (item: ActiveFilterItem) => {
    item.onClear?.();
  };

  return (
    <div className="tc-filter-summary">
      <div className="tc-filter-chip-list">
        {items.map((item) => (
          <div key={item.key} className={`tc-filter-chip ${toneClass(item.tone)}`}>
            <span>
              {item.label}: {item.value}
            </span>
            {item.onClear ? (
              <button type="button" className="tc-filter-chip-clear" onClick={() => handleClear(item)}>
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {onClearAll ? (
        <button className="tc-filter-chip tc-filter-chip-clear-all" type="button" onClick={onClearAll}>
          清除全部
        </button>
      ) : null}
    </div>
  );
}
