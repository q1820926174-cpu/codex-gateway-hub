import type { Metadata } from "next";
import { ClientProviders } from "@/components/client-providers";
// Import TDesign React UI library styles
// 导入 TDesign React UI 库样式
import "tdesign-react/es/style/index.css";
// Import React JSON View Lite styles
// 导入 React JSON View Lite 样式
import "react-json-view-lite/dist/index.css";
// Import global application styles
// 导入全局应用样式
import "./globals.css";

// Metadata for the application
// 应用程序的元数据
export const metadata: Metadata = {
  title: "Codex 模型网关 / Codex Gateway Hub",
  description:
    "多供应商、多本地 Key 的 Codex/OpenAI 兼容网关控制台 / Codex/OpenAI-compatible gateway console with multi-provider and multi-local-key support"
};

// Root layout component that wraps all pages
// 包装所有页面的根布局组件
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
