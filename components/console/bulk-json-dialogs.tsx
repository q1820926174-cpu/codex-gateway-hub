"use client";

import { Button, Dialog, Tag, Textarea } from "tdesign-react";
import { CodeBlock } from "@/components/code-block";

export type BulkJsonImportPreview = {
  state: "idle" | "error" | "ready";
  itemCount: number;
  enabledCount: number | null;
  appendTotal: number;
  replaceTotal: number;
  warnCount: number;
  errorCount: number;
  message: string;
  tone: "ok" | "warn" | "err" | "info";
};

type BulkJsonImportDialogLabels = {
  close: string;
  clear: string;
  loadClipboard: string;
  chooseFile: string;
  importCount: string;
  enabledCount: string;
  afterAppend: string;
  afterReplace: string;
  warnings: string;
  errors: string;
};

type BulkJsonImportDialogProps = {
  visible: boolean;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  sourceLabel?: string;
  idleHint: string;
  labels: BulkJsonImportDialogLabels;
  preview: BulkJsonImportPreview;
  appendLabel: string;
  replaceLabel: string;
  appendDisabled: boolean;
  replaceDisabled: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onClear: () => void;
  onLoadClipboard: () => void;
  onChooseFile: () => void;
  onAppend: () => void;
  onReplace: () => void;
};

type BulkJsonExportStat = {
  label: string;
  value: string | number;
  theme?: "default" | "primary" | "success" | "warning" | "danger";
};

type BulkJsonExportDialogProps = {
  visible: boolean;
  title: string;
  description: string;
  preview: string;
  language?: string;
  stats?: BulkJsonExportStat[];
  closeLabel: string;
  copyLabel: string;
  downloadLabel: string;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
};

function previewClassName(tone: BulkJsonImportPreview["tone"]) {
  if (tone === "ok") {
    return "tc-tip ok";
  }
  if (tone === "warn") {
    return "tc-tip";
  }
  if (tone === "err") {
    return "tc-tip err";
  }
  return "tc-tip";
}

export function BulkJsonImportDialog({
  visible,
  title,
  description,
  placeholder,
  value,
  sourceLabel,
  idleHint,
  labels,
  preview,
  appendLabel,
  replaceLabel,
  appendDisabled,
  replaceDisabled,
  onChange,
  onClose,
  onClear,
  onLoadClipboard,
  onChooseFile,
  onAppend,
  onReplace
}: BulkJsonImportDialogProps) {
  return (
    <Dialog
      visible={visible}
      width="min(92vw, 860px)"
      header={title}
      cancelBtn={labels.close}
      confirmBtn={null}
      onClose={onClose}
    >
      <div className="tc-quick-io-content">
        <p className="tc-upstream-advice">{description}</p>
        <div className="tc-actions-row">
          <Button variant="outline" theme="default" onClick={onLoadClipboard}>
            {labels.loadClipboard}
          </Button>
          <Button variant="outline" theme="default" onClick={onChooseFile}>
            {labels.chooseFile}
          </Button>
          <Button
            variant="text"
            theme="default"
            onClick={onClear}
            disabled={!value.trim()}
          >
            {labels.clear}
          </Button>
        </div>
        <Textarea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autosize={{ minRows: 12, maxRows: 24 }}
        />
        {sourceLabel ? <p className="tc-upstream-advice">{sourceLabel}</p> : null}
        {preview.state === "idle" ? <p className="tc-tip">{idleHint}</p> : null}
        {preview.state !== "idle" ? (
          <>
            {preview.state === "ready" ? (
              <div className="tc-actions-row">
                <Tag variant="light-outline">
                  {labels.importCount} {preview.itemCount}
                </Tag>
                {preview.enabledCount !== null ? (
                  <Tag variant="light-outline">
                    {labels.enabledCount} {preview.enabledCount}
                  </Tag>
                ) : null}
                <Tag
                  variant="light-outline"
                  theme={appendDisabled ? "danger" : "default"}
                >
                  {labels.afterAppend} {preview.appendTotal}
                </Tag>
                <Tag
                  variant="light-outline"
                  theme={replaceDisabled ? "danger" : "default"}
                >
                  {labels.afterReplace} {preview.replaceTotal}
                </Tag>
                {preview.warnCount > 0 ? (
                  <Tag variant="light-outline" theme="warning">
                    {labels.warnings} {preview.warnCount}
                  </Tag>
                ) : null}
                {preview.errorCount > 0 ? (
                  <Tag variant="light-outline" theme="danger">
                    {labels.errors} {preview.errorCount}
                  </Tag>
                ) : null}
              </div>
            ) : null}
            <p className={previewClassName(preview.tone)}>{preview.message}</p>
          </>
        ) : null}
        <div className="tc-quick-io-actions">
          <Button theme="primary" onClick={onAppend} disabled={appendDisabled}>
            {appendLabel}
          </Button>
          <Button
            theme="danger"
            variant="outline"
            onClick={onReplace}
            disabled={replaceDisabled}
          >
            {replaceLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function BulkJsonExportDialog({
  visible,
  title,
  description,
  preview,
  language = "json",
  stats = [],
  closeLabel,
  copyLabel,
  downloadLabel,
  onClose,
  onCopy,
  onDownload
}: BulkJsonExportDialogProps) {
  return (
    <Dialog
      visible={visible}
      width="min(92vw, 860px)"
      header={title}
      cancelBtn={closeLabel}
      confirmBtn={copyLabel}
      onConfirm={onCopy}
      onClose={onClose}
    >
      <div className="tc-quick-io-content">
        <p className="tc-upstream-advice">{description}</p>
        {stats.length > 0 ? (
          <div className="tc-actions-row">
            {stats.map((item) => (
              <Tag
                key={`${item.label}-${item.value}`}
                variant="light-outline"
                theme={item.theme ?? "default"}
              >
                {item.label} {item.value}
              </Tag>
            ))}
          </div>
        ) : null}
        <CodeBlock value={preview} language={language} />
        <div className="tc-quick-io-actions">
          <Button variant="outline" theme="default" onClick={onDownload}>
            {downloadLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
