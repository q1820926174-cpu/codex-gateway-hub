import { NextResponse } from "next/server";
import {
  buildEntryCookieValue,
  entryCookieOptions,
  resolveEntryCookieSecure,
  isEntrySecretEnabled,
  normalizeEntryNextPath,
  SECRET_ENTRY_COOKIE,
  verifyEntrySecret
} from "@/lib/entry-secret";
import {
  clearEntrySecretFailures,
  getEntrySecretGuardStatus,
  recordEntrySecretFailure
} from "@/lib/entry-secret-guard";
import { checkRateLimit } from "@/lib/rate-limit";

type SecretEntryPayload = {
  secret?: string;
  next?: string;
};

const SECRET_GUARD_POLICY = {
  bucket: "/api/secret-entry/failure",
  maxFailures: 6,
  windowMs: 5 * 60_000,
  lockMs: 15 * 60_000
} as const;

export async function POST(req: Request) {
  const guardStatus = getEntrySecretGuardStatus(req, SECRET_GUARD_POLICY);
  if (guardStatus.blocked) {
    return NextResponse.json(
      {
        error: "连续输错次数过多，请稍后再试。",
        retryAfterSeconds: guardStatus.retryAfterSeconds
      },
      { status: 429 }
    );
  }

  const rateLimit = checkRateLimit(req, {
    bucket: "/api/secret-entry",
    limit: 20,
    windowMs: 60_000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      },
      { status: 429 }
    );
  }

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
    const failureResult = recordEntrySecretFailure(req, SECRET_GUARD_POLICY);
    if (failureResult.blocked) {
      return NextResponse.json(
        {
          error: "连续输错次数过多，请稍后再试。",
          retryAfterSeconds: failureResult.retryAfterSeconds
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        error: "暗号错误，请重试。",
        remainingAttempts: failureResult.remainingFailures
      },
      { status: 401 }
    );
  }

  clearEntrySecretFailures(req, SECRET_GUARD_POLICY);

  const cookieSecure = resolveEntryCookieSecure(req);
  const response = NextResponse.json({
    ok: true,
    nextPath
  });
  response.cookies.set(
    SECRET_ENTRY_COOKIE,
    buildEntryCookieValue(),
    entryCookieOptions({ secure: cookieSecure })
  );
  return response;
}

export async function DELETE(req: Request) {
  const cookieSecure = resolveEntryCookieSecure(req);
  const response = NextResponse.json({
    ok: true
  });
  response.cookies.set(
    SECRET_ENTRY_COOKIE,
    "",
    entryCookieOptions({ maxAge: 0, secure: cookieSecure })
  );
  return response;
}
