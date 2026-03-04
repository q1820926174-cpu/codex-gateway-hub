import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { clearGatewayKeyCache } from "@/lib/upstream";
import {
  gatewayKeyDto,
  OPENAI_STYLE_LOCAL_KEY_MESSAGE,
  OPENAI_STYLE_LOCAL_KEY_REGEX
} from "@/lib/key-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const switchSelectorSchema = z.object({
  id: z.number().int().positive().optional(),
  localKey: z
    .string()
    .min(24)
    .max(256)
    .regex(OPENAI_STYLE_LOCAL_KEY_REGEX, OPENAI_STYLE_LOCAL_KEY_MESSAGE)
    .optional(),
  keyName: z.string().min(1).max(80).optional()
});

const switchModelSchema = switchSelectorSchema
  .extend({
    model: z.string().min(1).max(256).optional(),
    clear: z.boolean().default(false),
    syncDefaultModel: z.boolean().default(false),
    enabled: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    const model = value.model?.trim() ?? "";
    const hasModel = Boolean(model);
    const hasEnabledControl = typeof value.enabled === "boolean";

    if (value.clear && hasModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "model and clear cannot be set together."
      });
    }
    if (value.syncDefaultModel && (!hasModel || value.clear)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["syncDefaultModel"],
        message: "syncDefaultModel requires model and clear=false."
      });
    }
    if (!value.clear && !hasModel && !hasEnabledControl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "Provide at least one action: model, clear=true, or enabled."
      });
    }
  });

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorizationHeader.slice("bearer ".length).trim() || null;
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function maskLocalKey(localKey: string) {
  if (localKey.length <= 16) {
    return localKey;
  }
  return `${localKey.slice(0, 10)}...${localKey.slice(-6)}`;
}

function parseSelectorFromQuery(req: Request) {
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get("id");
  const localKeyRaw = searchParams.get("localKey");
  const keyNameRaw = searchParams.get("keyName");

  const parsedId = idRaw && idRaw.trim() ? Number(idRaw) : undefined;
  return {
    id: Number.isFinite(parsedId) ? parsedId : undefined,
    localKey: localKeyRaw?.trim() || undefined,
    keyName: keyNameRaw?.trim() || undefined
  };
}

async function resolveProviderKey(
  selector: { id?: number; localKey?: string; keyName?: string },
  authorizationHeader: string | null
) {
  if (selector.id) {
    const key = await prisma.providerKey.findUnique({ where: { id: selector.id } });
    if (key) {
      return { ok: true as const, key };
    }
    return {
      ok: false as const,
      status: 404,
      error: "Key not found by id."
    };
  }

  const explicitLocalKey = normalizeOptionalText(selector.localKey);
  if (explicitLocalKey) {
    const key = await prisma.providerKey.findUnique({
      where: { localKey: explicitLocalKey }
    });
    if (key) {
      return { ok: true as const, key };
    }
    return {
      ok: false as const,
      status: 404,
      error: "Key not found by localKey."
    };
  }

  const keyName = normalizeOptionalText(selector.keyName);
  if (keyName) {
    const matched = await prisma.providerKey.findMany({
      where: { name: keyName },
      orderBy: { id: "asc" },
      take: 2
    });
    if (matched.length === 1) {
      return { ok: true as const, key: matched[0] };
    }
    if (matched.length > 1) {
      return {
        ok: false as const,
        status: 409,
        error: `Multiple keys found by keyName="${keyName}". Please use id or localKey.`
      };
    }
    return {
      ok: false as const,
      status: 404,
      error: "Key not found by keyName."
    };
  }

  const tokenFromAuth = parseBearerToken(authorizationHeader);
  if (tokenFromAuth) {
    const key = await prisma.providerKey.findUnique({
      where: { localKey: tokenFromAuth }
    });
    if (key) {
      return { ok: true as const, key };
    }
    return {
      ok: false as const,
      status: 404,
      error: "Key not found by Authorization Bearer local_key."
    };
  }

  return {
    ok: false as const,
    status: 400,
    error: "Missing key selector. Provide id, localKey, keyName, or Authorization: Bearer <local_key>."
  };
}

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/keys/switch-model", async () => {
    const queryParsed = switchSelectorSchema.safeParse(parseSelectorFromQuery(req));
    if (!queryParsed.success) {
      return NextResponse.json(
        {
          error: "Invalid key selector",
          issues: queryParsed.error.issues
        },
        { status: 400 }
      );
    }

    const resolved = await resolveProviderKey(queryParsed.data, req.headers.get("authorization"));
    if (!resolved.ok) {
      return NextResponse.json(
        {
          error: resolved.error
        },
        { status: resolved.status }
      );
    }

    const key = resolved.key;
    const activeOverride = key.activeModelOverride?.trim() || null;
    return NextResponse.json({
      ok: true,
      key: {
        id: key.id,
        name: key.name,
        localKeyPreview: maskLocalKey(key.localKey),
        provider: key.provider
      },
      runtime: {
        enabled: key.enabled,
        defaultModel: key.defaultModel,
        activeModelOverride: activeOverride,
        effectiveModel: activeOverride || key.defaultModel,
        updatedAt: key.updatedAt.toISOString()
      },
      selectors: {
        supported: ["id", "localKey", "keyName", "Authorization: Bearer <local_key>"]
      }
    });
  });
}

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/keys/switch-model", async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = switchModelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid switch model payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const resolved = await resolveProviderKey(payload, req.headers.get("authorization"));
    if (!resolved.ok) {
      return NextResponse.json(
        {
          error: resolved.error
        },
        { status: resolved.status }
      );
    }

    const existing = resolved.key;
    const model = normalizeOptionalText(payload.model) || null;
    const updateData: {
      activeModelOverride?: string | null;
      defaultModel?: string;
      enabled?: boolean;
    } = {};

    if (payload.clear) {
      updateData.activeModelOverride = null;
    } else if (model) {
      updateData.activeModelOverride = model;
    }
    if (payload.syncDefaultModel && model) {
      updateData.defaultModel = model;
    }
    if (typeof payload.enabled === "boolean") {
      updateData.enabled = payload.enabled;
    }
    if (!Object.keys(updateData).length) {
      return NextResponse.json(
        {
          error: "No effective switch action found."
        },
        { status: 400 }
      );
    }

    const updated = await prisma.providerKey.update({
      where: { id: existing.id },
      data: updateData
    });
    clearGatewayKeyCache(updated.localKey);

    return NextResponse.json({
      ok: true,
      switchedAt: new Date().toISOString(),
      control: {
        action: {
          setOverrideModel: model || null,
          clearOverride: payload.clear,
          syncDefaultModel: Boolean(payload.syncDefaultModel && model),
          enabled: typeof payload.enabled === "boolean" ? payload.enabled : null
        },
        previousOverrideModel: existing.activeModelOverride,
        activeModelOverride: updated.activeModelOverride,
        previousDefaultModel: existing.defaultModel,
        defaultModel: updated.defaultModel,
        previousEnabled: existing.enabled,
        enabled: updated.enabled
      },
      key: gatewayKeyDto(updated)
    });
  });
}
