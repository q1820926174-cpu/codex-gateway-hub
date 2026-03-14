"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale, type LocaleCode } from "@/components/locale-provider";
import { ConsoleLayout } from "@/components/console/ConsoleLayout";
import { WorkspaceHero } from "@/components/console/workspace-hero";
import { ModuleSwitcherCards } from "@/components/console/module-switcher-cards";
import {
  LayoutDashboard,
  Settings,
  Clock,
  UserCircle,
  Code2
} from "lucide-react";
import { Card, Tag } from "tdesign-react";
import {
  MODULE_LABEL,
  MODULE_SUMMARY,
  type EditorModule
} from "@/components/console/types";
import { useKeys, useUpstreams } from "@/hooks/useApi";
import { motion } from "framer-motion";

function toLocaleKey(locale: LocaleCode): "zh" | "en" {
  return locale === "en-US" ? "en" : "zh";
}

type SettingsConsoleProps = {
  module?: EditorModule;
};

export function SettingsConsole({ module }: SettingsConsoleProps) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [activeModule, setActiveModule] = useState<EditorModule>(module || "access");
  const { data: keysData } = useKeys();
  const { data: upstreamsData } = useUpstreams();
  const lk = toLocaleKey(locale);

  const handleModuleChange = useCallback((newModule: EditorModule) => {
    setActiveModule(newModule);
    router.push(`/console/${newModule}`);
  }, [router]);

  useEffect(() => {
    if (module && module !== activeModule) {
      setActiveModule(module);
    }
  }, [module, activeModule]);

  const keys = (keysData as any)?.items || [];
  const upstreams = (upstreamsData as any)?.items || [];

  const moduleItems = [
    { id: "access" as EditorModule, title: MODULE_LABEL.access[lk], description: MODULE_SUMMARY.access[lk], icon: <UserCircle size={18} />, active: activeModule === "access", onSelect: (id: string) => handleModuleChange(id as EditorModule), value: keys.length ? `${keys.length} ` + t("个", "items") : undefined },
    { id: "prompt" as EditorModule, title: MODULE_LABEL.prompt[lk], description: MODULE_SUMMARY.prompt[lk], icon: <Code2 size={18} />, active: activeModule === "prompt", onSelect: (id: string) => handleModuleChange(id as EditorModule) },
    { id: "export" as EditorModule, title: MODULE_LABEL.export[lk], description: MODULE_SUMMARY.export[lk], icon: <Code2 size={18} />, active: activeModule === "export", onSelect: (id: string) => handleModuleChange(id as EditorModule), value: keys.length ? `${keys.length} ` + t("组可导出", "exportable") : undefined },
    { id: "upstream" as EditorModule, title: MODULE_LABEL.upstream[lk], description: MODULE_SUMMARY.upstream[lk], icon: <Code2 size={18} />, active: activeModule === "upstream", onSelect: (id: string) => handleModuleChange(id as EditorModule), value: upstreams.length ? `${upstreams.length} ` + t("个", "items") : undefined },
    { id: "runtime" as EditorModule, title: MODULE_LABEL.runtime[lk], description: MODULE_SUMMARY.runtime[lk], icon: <Settings size={18} />, active: activeModule === "runtime", onSelect: (id: string) => handleModuleChange(id as EditorModule) },
    { id: "logs" as EditorModule, title: MODULE_LABEL.logs[lk], description: MODULE_SUMMARY.logs[lk], icon: <Clock size={18} />, active: activeModule === "logs", onSelect: (id: string) => handleModuleChange(id as EditorModule) },
    { id: "calls" as EditorModule, title: MODULE_LABEL.calls[lk], description: MODULE_SUMMARY.calls[lk], icon: <LayoutDashboard size={18} />, active: activeModule === "calls", onSelect: (id: string) => handleModuleChange(id as EditorModule) },
    { id: "usage" as EditorModule, title: MODULE_LABEL.usage[lk], description: MODULE_SUMMARY.usage[lk], icon: <LayoutDashboard size={18} />, active: activeModule === "usage", onSelect: (id: string) => handleModuleChange(id as EditorModule) },
    { id: "docs" as EditorModule, title: MODULE_LABEL.docs[lk], description: MODULE_SUMMARY.docs[lk], icon: <Code2 size={18} />, active: activeModule === "docs", onSelect: (id: string) => handleModuleChange(id as EditorModule) }
  ];

  const heroStats = [
    { id: "keys", label: t("本地 Key", "Local Keys"), value: keys.length ? String(keys.length) : "-", tone: "default" as const },
    { id: "upstreams", label: t("上游渠道", "Upstreams"), value: upstreams.length ? String(upstreams.length) : "-", tone: "accent" as const },
    { id: "requests", label: t("最近请求", "Recent Requests"), value: "-", tone: "success" as const },
    { id: "tokens", label: t("Token 消耗", "Tokens Used"), value: "-", tone: "warning" as const }
  ];

  const heroActions = [
    { id: "new-key", label: t("创建 Key", "Create Key"), note: t("快速创建本地 Key", "Quickly create a local key"), onClick: () => router.push("/console/access"), disabled: false },
    { id: "new-upstream", label: t("添加渠道", "Add Upstream"), note: t("配置新的上游供应商", "Configure a new upstream provider"), onClick: () => router.push("/console/upstream"), disabled: false },
    { id: "view-docs", label: t("查看文档", "View Docs"), note: t("API 文档与示例", "API docs and examples"), onClick: () => router.push("/console/docs"), disabled: false }
  ];

  return (
    <ConsoleLayout
      activeModule={activeModule}
      onModuleChange={handleModuleChange}
      headerSubtitle={t("欢迎回来", "Welcome back")}
    >
      <div className="tc-overview-zone">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <WorkspaceHero
            title={t("Codex Gateway", "Codex Gateway")}
            subtitle={t(
              "多供应商、多本地 Key 的模型网关控制台",
              "Multi-provider, multi-local-key model gateway console"
            )}
            stats={heroStats}
            actions={heroActions}
            rightSlot={
              <div className="tc-workspace-hero-tags">
                <Tag variant="light-outline">Next.js 16</Tag>
                <Tag variant="light-outline">TDesign</Tag>
                <Tag variant="light-outline">TanStack Query</Tag>
              </div>
            }
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <ModuleSwitcherCards title={t("控制台模块", "Console Modules")} items={moduleItems} />
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.2 }} className="mt-4">
          <Card className="tc-panel">
            <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}>
              {t("重构进行中...", "Refactoring in progress...")}
            </h3>
            <p style={{ margin: "12px 0 0", fontSize: "13px", color: "#5c6b85", lineHeight: 1.6 }}>
              {t(
                "首页已使用新架构（ConsoleLayout + TanStack Query + Framer Motion）。其他模块正在迁移中。",
                "Homepage uses new architecture (ConsoleLayout + TanStack Query + Framer Motion). Other modules are being migrated."
              )}
            </p>
          </Card>
        </motion.div>
      </div>
    </ConsoleLayout>
  );
}
