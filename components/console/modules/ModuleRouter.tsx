"use client";

import dynamic from "next/dynamic";
import type { EditorModule } from "@/components/console/types";
import { PromptModule } from "@/components/console/modules/PromptModule";

type ModuleRouterProps = {
  module?: EditorModule;
};

const LegacySettingsConsole = dynamic(
  () => import("@/components/settings-console").then((module) => module.SettingsConsole),
  {
    ssr: false,
    loading: () => null
  }
);

/**
 * ModuleRouter - 所有模块使用原始完整功能组件
 * 原始 settings-console.tsx 包含完整的 Key/Upstream/Runtime/Logs/Calls/Usage/Docs 功能
 * 新组件体系（ConsoleLayout, TanStack Query 等）将在后续逐步替换各模块内部实现
 */
export function ModuleRouter({ module }: ModuleRouterProps) {
  if (module === "prompt") {
    return <PromptModule />;
  }
  return <LegacySettingsConsole module={module} />;
}
