import { redirect } from "next/navigation";
import { SecretEntryForm } from "@/components/secret-entry-form";
import {
  isEntrySecretEnabled,
  isEntryAuthenticated,
  normalizeEntryNextPath
} from "@/lib/entry-secret";

export default async function SecretEntryPage(
  props: { searchParams: Promise<{ next?: string }> }
) {
  if (!isEntrySecretEnabled()) {
    redirect("/console/access");
  }

  const searchParams = await props.searchParams;
  const nextPath = normalizeEntryNextPath(searchParams.next);

  if (await isEntryAuthenticated()) {
    redirect(nextPath);
  }

  return <SecretEntryForm nextPath={nextPath} />;
}
