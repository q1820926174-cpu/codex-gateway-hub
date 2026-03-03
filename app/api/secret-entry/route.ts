import { NextResponse } from "next/server";
import {
  buildEntryCookieValue,
  entryCookieOptions,
  isEntrySecretEnabled,
  normalizeEntryNextPath,
  SECRET_ENTRY_COOKIE,
  verifyEntrySecret
} from "@/lib/entry-secret";

type SecretEntryPayload = {
  secret?: string;
  next?: string;
};

export async function POST(req: Request) {
  const payload = (await req.json().catch(() => ({}))) as SecretEntryPayload;
  const secret = typeof payload.secret === "string" ? payload.secret : "";
  const nextPath = normalizeEntryNextPath(payload.next);

  if (!isEntrySecretEnabled()) {
    return NextResponse.json({
      ok: true,
      nextPath
    });
  }

  if (!verifyEntrySecret(secret)) {
    return NextResponse.json(
      {
        error: "暗号错误，请重试。"
      },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    nextPath
  });
  response.cookies.set(
    SECRET_ENTRY_COOKIE,
    buildEntryCookieValue(),
    entryCookieOptions()
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({
    ok: true
  });
  response.cookies.set(
    SECRET_ENTRY_COOKIE,
    "",
    entryCookieOptions(0)
  );
  return response;
}
