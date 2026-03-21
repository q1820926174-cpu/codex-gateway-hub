import { Button, Select } from "tdesign-react";

export type FilterPreset = {
  id: string;
  name: string;
  description?: string;
};

type FilterPresetBarProps = {
  presets: FilterPreset[];
  activePresetId?: string;
  onSelectPreset?: (id: string) => void;
  onSavePreset?: (name: string) => void;
  onDeletePreset?: (id: string) => void;
  onReset?: () => void;
};

export function FilterPresetBar({
  presets,
  activePresetId,
  onSelectPreset,
  onSavePreset,
  onDeletePreset,
  onReset
}: FilterPresetBarProps) {
  const handlePresetChange = (value: unknown) => {
    const next = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
    if (next) {
      onSelectPreset?.(next);
    }
  };

  return (
    <div className="tc-filter-preset-bar">
      <div className="tc-filter-presets">
        <div className="tc-filter-preset-select">
          <span className="tc-filter-section-title">常用视图</span>
          <Select
            clearable={false}
            onChange={handlePresetChange}
            options={[
              { label: "默认", value: "" },
              ...presets.map((preset) => ({
                label: preset.name,
                value: preset.id
              }))
            ]}
            size="small"
            value={activePresetId ?? ""}
          />
        </div>
      </div>
      <div className="tc-filter-preset-controls">
        <Button onClick={() => onSavePreset?.("新筛选")} size="small" variant="outline">
          保存当前
        </Button>
        {activePresetId ? (
          <Button onClick={() => onDeletePreset?.(activePresetId)} size="small" theme="danger" variant="outline">
            删除
          </Button>
        ) : null}
        {onReset ? (
          <Button onClick={onReset} size="small" variant="outline">
            重置
          </Button>
        ) : null}
      </div>
    </div>
  );
}
