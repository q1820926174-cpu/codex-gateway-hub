import type { Metadata } from "next";
import { ClientProviders } from "@/components/client-providers";
import "tdesign-react/es/style/index.css";
import "react-json-view-lite/dist/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex 模型网关 / Codex Gateway Hub",
  description:
    "多供应商、多本地 Key 的 Codex/OpenAI 兼容网关控制台 / Codex/OpenAI-compatible gateway console with multi-provider and multi-local-key support"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
