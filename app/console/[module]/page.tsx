import { notFound } from "next/navigation";
import { SettingsConsole, type EditorModule } from "@/components/settings-console";
import { ensureEntryAccess } from "@/lib/entry-secret";

const CONSOLE_MODULES = ["access", "upstream", "runtime", "logs", "calls", "usage", "docs"] as const;

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
  return <SettingsConsole module={module} />;
}
