import { redirect } from "next/navigation";
import { ensureEntryAccess } from "@/lib/entry-secret";

export default async function ConsoleIndexPage() {
  await ensureEntryAccess("/console/access");
  redirect("/console/access");
}
