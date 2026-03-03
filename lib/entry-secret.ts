import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SECRET_ENTRY_COOKIE = "gateway_secret_entry";
const DEFAULT_NEXT_PATH = "/console/access";

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompareString(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getEntrySecret() {
  return (process.env.CONSOLE_ENTRY_SECRET ?? "").trim();
}

export function isEntrySecretEnabled() {
  return Boolean(getEntrySecret());
}

export function buildEntryCookieValue(secret = getEntrySecret()) {
  if (!secret) {
    return "";
  }
  return `v1.${sha256Hex(`console-entry:${secret}`)}`;
}

export function verifyEntrySecret(inputSecret: string) {
  const expectedSecret = getEntrySecret();
  if (!expectedSecret) {
    return true;
  }
  return safeCompareString(inputSecret.trim(), expectedSecret);
}

export function isEntryCookieValid(cookieValue: string) {
  const expectedCookieValue = buildEntryCookieValue();
  if (!expectedCookieValue) {
    return true;
  }
  return safeCompareString(cookieValue, expectedCookieValue);
}

export function normalizeEntryNextPath(rawNextPath: string | undefined | null) {
  if (typeof rawNextPath !== "string") {
    return DEFAULT_NEXT_PATH;
  }
  const trimmed = rawNextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }
  if (trimmed.startsWith("/secret-entry")) {
    return DEFAULT_NEXT_PATH;
  }
  return trimmed || DEFAULT_NEXT_PATH;
}

export function entryCookieOptions(maxAge = 60 * 60 * 24 * 7) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  };
}

export async function isEntryAuthenticated() {
  if (!isEntrySecretEnabled()) {
    return true;
  }
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SECRET_ENTRY_COOKIE)?.value ?? "";
  return isEntryCookieValid(cookieValue);
}

export async function ensureEntryAccess(nextPath = DEFAULT_NEXT_PATH) {
  if (!isEntrySecretEnabled()) {
    return;
  }
  if (await isEntryAuthenticated()) {
    return;
  }
  const safeNextPath = normalizeEntryNextPath(nextPath);
  redirect(`/secret-entry?next=${encodeURIComponent(safeNextPath)}`);
}
