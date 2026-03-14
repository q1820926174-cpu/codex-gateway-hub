"use client";

import "tdesign-react/es/_util/react-19-adapter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { LocaleProvider } from "@/components/locale-provider";

// Create a new QueryClient instance with default options
// 创建一个带有默认选项的新 QueryClient 实例
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays fresh for 1 minute
        // 数据在 1 分钟内保持新鲜
        staleTime: 60 * 1000,
        // Don't refetch when window regains focus
        // 窗口重新获得焦点时不重新获取
        refetchOnWindowFocus: false
      }
    }
  });
}

// Singleton QueryClient instance for browser
// 浏览器端的单例 QueryClient 实例
let browserQueryClient: QueryClient | undefined = undefined;

// Get or create QueryClient instance (handles SSR and browser environments)
// 获取或创建 QueryClient 实例（处理 SSR 和浏览器环境）
function getQueryClient() {
  // Server-side: create new instance for each request
  // 服务端：为每个请求创建新实例
  if (typeof window === "undefined") {
    return makeQueryClient();
  } else {
    // Browser: reuse singleton instance
    // 浏览器端：复用单例实例
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

// Props type for ClientProviders component
// ClientProviders 组件的属性类型
type ClientProvidersProps = {
  children: React.ReactNode;
};

// Client-side providers wrapper component
// 客户端提供程序包装组件
export function ClientProviders({ children }: ClientProvidersProps) {
  // Initialize QueryClient with useState to ensure it's created only once
  // 使用 useState 初始化 QueryClient 以确保只创建一次
  const [queryClient] = useState(() => getQueryClient());

  return (
    // Provide React Query context and Locale context
    // 提供 React Query 上下文和国际化上下文
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>{children}</LocaleProvider>
    </QueryClientProvider>
  );
}
