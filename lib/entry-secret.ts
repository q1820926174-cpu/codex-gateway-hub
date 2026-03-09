import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SECRET_ENTRY_COOKIE = "gateway_secret_entry";
const DEFAULT_NEXT_PATH = "/console/access";
const DEFAULT_ENTRY_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

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

function parseBooleanEnv(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

export function resolveEntryCookieSecure(req?: Request) {
  const overrideSecure = parseBooleanEnv(process.env.CONSOLE_ENTRY_COOKIE_SECURE);
  if (typeof overrideSecure === "boolean") {
    return overrideSecure;
  }

  if (req) {
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const firstForwardedProto = forwardedProto?.split(",")[0]?.trim().toLowerCase() ?? "";
    if (firstForwardedProto) {
      return firstForwardedProto === "https";
    }

    try {
      return new URL(req.url).protocol === "https:";
    } catch {
      return process.env.NODE_ENV === "production";
    }
  }

  return process.env.NODE_ENV === "production";
}

export function entryCookieOptions(options?: { maxAge?: number; secure?: boolean }) {
  const maxAge = options?.maxAge ?? DEFAULT_ENTRY_COOKIE_MAX_AGE;
  const secure = typeof options?.secure === "boolean" ? options.secure : resolveEntryCookieSecure();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
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
