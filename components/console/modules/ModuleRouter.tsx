"use client";

import { SettingsConsole } from "@/components/settings-console";
import type { EditorModule } from "@/components/console/types";

type ModuleRouterProps = {
  module?: EditorModule;
};

/**
 * ModuleRouter - 所有模块使用原始完整功能组件
 * 原始 settings-console.tsx 包含完整的 Key/Upstream/Runtime/Logs/Calls/Usage/Docs 功能
 * 新组件体系（ConsoleLayout, TanStack Query 等）将在后续逐步替换各模块内部实现
 */
export function ModuleRouter({ module }: ModuleRouterProps) {
  return <SettingsConsole module={module} />;
}
