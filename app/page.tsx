import { redirect } from "next/navigation";
import { ensureEntryAccess } from "@/lib/entry-secret";

// Root page component - redirects to console
// 根页面组件 - 重定向到控制台
export default async function Page() {
  // Ensure user has entry access before redirecting
  // 重定向前确保用户有入口访问权限
  await ensureEntryAccess("/console/access");
  // Redirect to the access module in console
  // 重定向到控制台的访问模块
  redirect("/console/access");
}
