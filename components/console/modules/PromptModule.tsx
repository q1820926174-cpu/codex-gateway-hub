"use client";

import { SettingsConsole } from "@/components/settings-console";

/**
 * PromptModule
 * 先将 Prompt 相关能力收敛为独立模块入口，后续可继续将内部逻辑拆分到专用 hooks/components。
 */
export function PromptModule() {
  return <SettingsConsole module="prompt" />;
}

