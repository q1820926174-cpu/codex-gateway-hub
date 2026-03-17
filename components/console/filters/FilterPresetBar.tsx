import type { ChangeEventHandler } from "react";

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
  const handlePresetChange: ChangeEventHandler<HTMLSelectElement> = (event) => {
    const next = event.target.value;
    if (next) {
      onSelectPreset?.(next);
    }
  };

  return (
    <div className="tc-filter-preset-bar">
      <div className="tc-filter-presets">
        <label>
          <span className="tc-filter-section-title">常用视图</span>
          <select value={activePresetId ?? ""} onChange={handlePresetChange}>
            <option value="">默认</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tc-filter-preset-controls">
        <button type="button" onClick={() => onSavePreset?.("新筛选")}>
          保存当前
        </button>
        {activePresetId ? (
          <button type="button" onClick={() => onDeletePreset?.(activePresetId)}>
            删除
          </button>
        ) : null}
        {onReset ? (
          <button type="button" onClick={onReset}>
            重置
          </button>
        ) : null}
      </div>
    </div>
  );
}
