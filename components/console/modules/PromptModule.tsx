"use client";

import dynamic from "next/dynamic";

const LegacySettingsConsole = dynamic(
  () => import("@/components/settings-console").then((module) => module.SettingsConsole),
  {
    ssr: false,
    loading: () => null
  }
);

/**
 * PromptModule
 * 先将 Prompt 相关能力收敛为独立模块入口，后续可继续将内部逻辑拆分到专用 hooks/components。
 */
export function PromptModule() {
  return <LegacySettingsConsole module="prompt" />;
}
