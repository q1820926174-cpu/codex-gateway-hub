import { NextResponse } from "next/server";
import {
  getEntrySecret,
  isEntryCookieValid,
  SECRET_ENTRY_COOKIE,
  verifyEntrySecret
} from "@/lib/entry-secret";

function resolveBearerToken(authorization: string | null) {
  if (!authorization) {
    return "";
  }
  const trimmed = authorization.trim();
  if (!trimmed.startsWith("Bearer ")) {
    return "";
  }
  return trimmed.slice("Bearer ".length).trim();
}

function readCookieValue(req: Request, cookieName: string) {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return "";
  }
  const cookieItems = cookieHeader.split(";");
  for (const cookieItem of cookieItems) {
    const [rawName, ...rawValueParts] = cookieItem.split("=");
    if (!rawName || rawValueParts.length === 0) {
      continue;
    }
    if (rawName.trim() !== cookieName) {
      continue;
    }
    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) {
      return "";
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return "";
}

export function requireConsoleApiAuth(req: Request): NextResponse | null {
  const entrySecret = getEntrySecret();
  if (!entrySecret) {
    if (process.env.NODE_ENV !== "production") {
      return null;
    }
    return NextResponse.json(
      {
        error: "CONSOLE_ENTRY_SECRET is required in production."
      },
      { status: 503 }
    );
  }

  const bearerToken = resolveBearerToken(req.headers.get("authorization"));
  if (bearerToken && verifyEntrySecret(bearerToken)) {
    return null;
  }

  const entryCookieValue = readCookieValue(req, SECRET_ENTRY_COOKIE);
  if (entryCookieValue && isEntryCookieValid(entryCookieValue)) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Unauthorized."
    },
    { status: 401 }
  );
}
