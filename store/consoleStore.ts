import { create } from "zustand";
import { type EditorModule } from "@/components/console/types";

// Zustand store type definition for console UI state
// 控制台 UI 状态的 Zustand store 类型定义
type ConsoleStore = {
  // Currently active console module
  // 当前激活的控制台模块
  activeModule: EditorModule;
  // Set the active console module
  // 设置激活的控制台模块
  setActiveModule: (module: EditorModule) => void;
  // Loading state indicator
  // 加载状态指示器
  isLoading: boolean;
  // Set loading state
  // 设置加载状态
  setIsLoading: (loading: boolean) => void;
  // Sidebar collapsed state
  // 侧边栏折叠状态
  sidebarCollapsed: boolean;
  // Toggle sidebar collapsed state
  // 切换侧边栏折叠状态
  toggleSidebar: () => void;
};

// Zustand store for managing console UI state
// 管理控制台 UI 状态的 Zustand store
export const useConsoleStore = create<ConsoleStore>((set) => ({
  // Default to "access" module
  // 默认为 "access" 模块
  activeModule: "access",
  setActiveModule: (module) => set({ activeModule: module }),
  // Default to not loading
  // 默认不加载
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  // Default to sidebar expanded
  // 默认侧边栏展开
  sidebarCollapsed: false,
  // Toggle function for sidebar
  // 侧边栏切换函数
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
}));
