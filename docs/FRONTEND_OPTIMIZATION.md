# 前端组件化优化指南

本项目已引入多种成熟的前端工具库和组件，避免重复造轮子。

## 已安装的库

### 🎨 UI & 组件库
- **TDesign** - 企业级组件库（已存在）
- **Lucide React** - 现代化图标库

### 📊 数据处理
- **TanStack Table** - 功能强大的表格组件
- **TanStack Virtual** - 虚拟滚动，处理大数据列表

### 📝 表单处理
- **React Hook Form** - 高性能表单库

### 🔄 状态管理 & 数据获取
- **Zustand** - 轻量级状态管理
- **TanStack Query** - 服务端状态管理和缓存

### ✨ 动画 & 交互动效
- **Framer Motion** - 流畅的动画库

### 🛠️ 工具函数
- **clsx + tailwind-merge** - 类名合并工具

## 组件目录结构

```
components/
├── console/              # 控制台专用组件
│   ├── index.ts         # 统一导出
│   ├── types.ts         # 类型定义
│   ├── ConsoleLayout.tsx
│   ├── ConsoleSidebar.tsx
│   └── ConsoleHeader.tsx
├── ui/                   # 通用 UI 组件
│   ├── index.ts         # 统一导出
│   ├── DataTable.tsx    # TanStack Table 封装
│   ├── VirtualList.tsx  # 虚拟列表
│   └── AnimatedCard.tsx # 动画卡片
└── settings-console.tsx # 原有完整组件（逐步迁移）

store/                   # Zustand 状态管理
└── consoleStore.ts

lib/
├── console-utils.ts     # 控制台工具函数
└── utils.ts            # 通用工具函数
```

## 使用示例

### 1. DataTable - 数据表格

```tsx
import { DataTable } from "@/components/ui";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<User>[] = [
  { accessorKey: "name", header: "姓名" },
  { accessorKey: "email", header: "邮箱" }
];

<DataTable 
  columns={columns} 
  data={users} 
  searchColumn="name"
  searchPlaceholder="搜索用户..."
/>
```

### 2. VirtualList - 虚拟列表（大数据）

```tsx
import { VirtualList } from "@/components/ui";

<VirtualList
  data={largeDataset}
  itemHeight={60}
  renderItem={(item, index) => (
    <div key={index}>{item.content}</div>
  )}
/>
```

### 3. Zustand 状态管理

```tsx
import { useConsoleStore } from "@/store/consoleStore";

const { activeModule, setActiveModule } = useConsoleStore();
```

### 4. 工具函数

```tsx
import { cn, debounce, safeJsonParse } from "@/lib/utils";

// 合并类名
const className = cn("base-class", condition && "optional-class");

// 防抖
const handleSearch = debounce((query) => { ... }, 300);

// 安全 JSON 解析
const data = safeJsonParse(str, fallbackValue);
```

## 迁移策略

由于 `settings-console.tsx` 较大（6000+ 行），采用渐进式迁移：

1. **保持现有功能** - 原组件继续工作
2. **按需迁移** - 逐个功能模块迁移到新结构
3. **新功能用新组件** - 新增功能使用新组件库

## 性能优化建议

1. 大数据列表使用 `VirtualList` 虚拟滚动
2. 表格使用 `DataTable` 的分页和筛选
3. 复杂动画使用 `Framer Motion`
4. 全局状态使用 `Zustand` 避免 prop drilling
