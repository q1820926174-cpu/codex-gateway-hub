"use client";

import { useRouter } from "next/navigation";
import { Menu } from "tdesign-react";
import {
  LayoutDashboard,
  Settings,
  Clock,
  UserCircle,
  Code2
} from "lucide-react";
import { useLocale, type LocaleCode } from "@/components/locale-provider";
import {
  MODULE_LABEL,
  type EditorModule
} from "@/components/console/types";

function toLocaleKey(locale: LocaleCode): "zh" | "en" {
  return locale === "en-US" ? "en" : "zh";
}

type ConsoleSidebarProps = {
  activeModule: EditorModule;
  onModuleChange: (module: EditorModule) => void;
};

export function ConsoleSidebar({ activeModule, onModuleChange }: ConsoleSidebarProps) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const lk = toLocaleKey(locale);

  const menuItems = [
    { value: "access", label: MODULE_LABEL.access[lk], icon: <UserCircle size={18} /> },
    { value: "prompt", label: MODULE_LABEL.prompt[lk], icon: <Code2 size={18} /> },
    { value: "export", label: MODULE_LABEL.export[lk], icon: <Code2 size={18} /> },
    { value: "upstream", label: MODULE_LABEL.upstream[lk], icon: <Code2 size={18} /> },
    { value: "runtime", label: MODULE_LABEL.runtime[lk], icon: <Settings size={18} /> },
    { value: "logs", label: MODULE_LABEL.logs[lk], icon: <Clock size={18} /> },
    { value: "calls", label: MODULE_LABEL.calls[lk], icon: <LayoutDashboard size={18} /> },
    { value: "usage", label: MODULE_LABEL.usage[lk], icon: <LayoutDashboard size={18} /> },
    { value: "docs", label: MODULE_LABEL.docs[lk], icon: <Code2 size={18} /> }
  ];

  const handleMenuChange = (value: unknown) => {
    const module = Array.isArray(value) ? value[0] : String(value);
    if (module && ["access", "prompt", "export", "upstream", "runtime", "logs", "calls", "usage", "docs"].includes(module)) {
      onModuleChange(module as EditorModule);
      router.push(`/console/${module}`);
    }
  };

  return (
    <aside className="tc-aside t-layout__sider">
      <div className="tc-brand">
        <div className="tc-brand-title">Codex Gateway</div>
        <div className="tc-brand-sub">AI Gateway Workspace</div>
      </div>
      <Menu
        className="tc-side-menu"
        value={activeModule}
        onChange={handleMenuChange}
        theme="light"
      >
        {menuItems.map((item) => (
          <Menu.MenuItem key={item.value} value={item.value} icon={item.icon}>
            {item.label}
          </Menu.MenuItem>
        ))}
      </Menu>
      <div className="tc-aside-footer">v1.0</div>
    </aside>
  );
}
