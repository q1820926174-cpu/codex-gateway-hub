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
      <Layout className="tc-layout">
        <ConsoleSidebar activeModule={activeModule} onModuleChange={onModuleChange} />
        <Layout className="tc-main">
          <ConsoleHeader activeModule={activeModule} subtitle={headerSubtitle}>
            {headerChildren}
          </ConsoleHeader>
          <Layout.Content className="tc-content">{children}</Layout.Content>
        </Layout>
      </Layout>
    </div>
  );
}
