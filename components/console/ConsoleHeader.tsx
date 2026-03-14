"use client";

import { useLocale } from "@/components/locale-provider";
import { MODULE_LABEL, type EditorModule } from "@/components/console/types";

type ConsoleHeaderProps = {
  activeModule: EditorModule;
  subtitle?: string;
  children?: React.ReactNode;
};

function localeKey(locale: string): "zh" | "en" {
  return locale === "en-US" ? "en" : "zh";
}

export function ConsoleHeader({ activeModule, subtitle, children }: ConsoleHeaderProps) {
  const { t, locale } = useLocale();
  const label = MODULE_LABEL[activeModule][localeKey(locale)];

  return (
    <header className="tc-header t-layout__header">
      <div className="tc-header-left">
        <div className="tc-header-title-wrap">
          <div className="tc-header-title">{label}</div>
          {subtitle ? <div className="tc-header-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {children ? <div className="tc-header-right">{children}</div> : null}
    </header>
  );
}
