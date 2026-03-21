import { Button, Tag } from "tdesign-react";

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

  const resolveToneTheme = (tone: ActiveFilterItem["tone"]) => {
    switch (tone) {
      case "primary":
        return "primary";
      case "warning":
        return "warning";
      case "success":
        return "success";
      default:
        return "default";
    }
  };

  const handleClear = (item: ActiveFilterItem) => {
    item.onClear?.();
  };

  return (
    <div className="tc-filter-summary">
      <div className="tc-filter-chip-list">
        {items.map((item) => (
          <Tag
            key={item.key}
            className="tc-filter-chip"
            closable={Boolean(item.onClear)}
            onClose={() => handleClear(item)}
            theme={resolveToneTheme(item.tone)}
            variant="light-outline"
          >
            {item.label}: {item.value}
          </Tag>
        ))}
      </div>
      {onClearAll ? (
        <Button
          className="tc-filter-chip-clear-all"
          onClick={onClearAll}
          size="small"
          theme="default"
          variant="text"
        >
          清除全部
        </Button>
      ) : null}
    </div>
  );
}
