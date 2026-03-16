import { notFound } from "next/navigation";
import { ModuleRouter } from "@/components/console/modules/ModuleRouter";
import type { EditorModule } from "@/components/console/types";
import { ensureEntryAccess } from "@/lib/entry-secret";

const CONSOLE_MODULES = ["access", "prompt", "export", "upstream", "runtime", "logs", "calls", "usage", "docs", "dashboard"] as const;

function isConsoleModule(value: string): value is EditorModule {
  return (CONSOLE_MODULES as readonly string[]).includes(value);
}

export default async function ConsoleModulePage(
  props: { params: Promise<{ module: string }> }
) {
  const { module } = await props.params;
  if (!isConsoleModule(module)) {
    notFound();
  }

  await ensureEntryAccess(`/console/${module}`);
  return <ModuleRouter module={module} />;
}
