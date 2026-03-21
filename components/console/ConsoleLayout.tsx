"use client";

import { Layout } from "tdesign-react";
import { ConsoleSidebar } from "@/components/console/ConsoleSidebar";
import { ConsoleHeader } from "@/components/console/ConsoleHeader";
import { type EditorModule } from "@/components/console/types";

type ConsoleLayoutProps = {
  activeModule: EditorModule;
  onModuleChange: (module: EditorModule) => void;
  headerSubtitle?: string;
  headerChildren?: React.ReactNode;
  children: React.ReactNode;
};

export function ConsoleLayout({
  activeModule,
  onModuleChange,
  headerSubtitle,
  headerChildren,
  children
}: ConsoleLayoutProps) {
  return (
    <div className="tc-console">
      <a className="tc-skip-link" href="#console-main">
        跳到主内容 / Skip to main content
      </a>
      <Layout className="tc-layout">
        <ConsoleSidebar activeModule={activeModule} onModuleChange={onModuleChange} />
        <main id="console-main" className="tc-main" tabIndex={-1}>
          <ConsoleHeader activeModule={activeModule} subtitle={headerSubtitle}>
            {headerChildren}
          </ConsoleHeader>
          <Layout.Content className="tc-content">{children}</Layout.Content>
        </main>
      </Layout>
    </div>
  );
}
