import { NextResponse } from "next/server";
import { Prisma, type UpstreamChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import {
  createGatewayKeySchema,
  ensureModelExistsInPool,
  gatewayKeyDto,
  normalizeKeyModelMappings,
  normalizeUpstreamModels,
  normalizeUpstreamWireApiValue,
  pickModelFromPool,
  resolveUpstreamBaseUrl,
  serializeKeyModelMappings,
  serializeUpstreamModels,
  UPSTREAM_WIRE_APIS
} from "@/lib/key-config";
import { normalizeUpstreamModelCode, PROVIDERS } from "@/lib/providers";
import { clearGatewayKeyCache } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_WITH_CHANNEL_SELECT = {
  id: true,
  name: true,
  provider: true,
  upstreamWireApi: true,
  upstreamBaseUrl: true,
  upstreamApiKey: true,
  upstreamModelsJson: true,
  defaultModel: true,
  supportsVision: true,
  visionModel: true,
  timeoutMs: true
} as const;

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/keys", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const keys = await prisma.providerKey.findMany({
      include: {
        upstreamChannel: {
          select: KEY_WITH_CHANNEL_SELECT
        }
      },
      orderBy: [{ createdAt: "desc" }]
    });

    return NextResponse.json({
      items: keys.map(gatewayKeyDto),
      providers: PROVIDERS,
      upstreamWireApis: UPSTREAM_WIRE_APIS,
      wireApi: "responses"
    });
  });
}

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/keys", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const body = await req.json().catch(() => ({}));
    const parsed = createGatewayKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid key payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const keyModelMappings = normalizeKeyModelMappings(payload.modelMappings);
    let upstreamChannel: UpstreamChannel | null = null;
    if (payload.upstreamChannelId !== undefined) {
      upstreamChannel = await prisma.upstreamChannel.findUnique({
        where: { id: payload.upstreamChannelId }
      });
      if (!upstreamChannel || !upstreamChannel.enabled) {
        return NextResponse.json(
          {
            error: "Selected upstream channel not found or disabled."
          },
          { status: 400 }
        );
      }
    }

    const defaultModel = (upstreamChannel?.defaultModel ?? payload.defaultModel).trim();
    const effectiveProvider = (upstreamChannel?.provider ?? payload.provider) as (typeof PROVIDERS)[number];
    const effectiveWireApi = normalizeUpstreamWireApiValue(
      upstreamChannel?.upstreamWireApi ?? payload.upstreamWireApi
    ) as (typeof UPSTREAM_WIRE_APIS)[number];
    const normalizedModelMappings = keyModelMappings.map((item) => ({
      ...item,
      targetModel: normalizeUpstreamModelCode(effectiveProvider, item.targetModel)
    }));
    const fallbackVisionModel =
      (upstreamChannel?.visionModel ?? payload.visionModel)?.trim() || null;
    const normalizedPool = normalizeUpstreamModels(
      upstreamChannel?.upstreamModelsJson ?? payload.upstreamModels,
      {
        model: defaultModel,
        upstreamWireApi: effectiveWireApi,
        supportsVision: upstreamChannel?.supportsVision ?? payload.supportsVision,
        visionModel: fallbackVisionModel
      }
    );
    const upstreamModels = ensureModelExistsInPool(normalizedPool, defaultModel, {
      upstreamWireApi: effectiveWireApi,
      supportsVision: upstreamChannel?.supportsVision ?? payload.supportsVision,
      visionModel: fallbackVisionModel
    });
    const defaultProfile =
      pickModelFromPool(upstreamModels, defaultModel) ?? upstreamModels[0] ?? null;
    if (!defaultProfile) {
      return NextResponse.json(
        {
          error: "At least one upstream model is required."
        },
        { status: 400 }
      );
    }

    let upstreamBaseUrl: string;
    try {
      upstreamBaseUrl = resolveUpstreamBaseUrl(
        effectiveProvider,
        upstreamChannel?.upstreamBaseUrl ?? payload.upstreamBaseUrl
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid upstream base url." },
        { status: 400 }
      );
    }

    try {
      const effectiveUpstreamApiKey =
        upstreamChannel?.upstreamApiKey ?? payload.upstreamApiKey?.trim() ?? null;

      const created = await prisma.providerKey.create({
        data: {
          name: payload.name.trim(),
          localKey: payload.localKey.trim(),
          ...(upstreamChannel
            ? {
                upstreamChannel: {
                  connect: {
                    id: upstreamChannel.id
                  }
                }
              }
            : {}),
          provider: effectiveProvider,
          wireApi: "responses",
          upstreamWireApi: defaultProfile.upstreamWireApi,
          upstreamBaseUrl,
          upstreamApiKey: effectiveUpstreamApiKey,
          upstreamModelsJson: serializeUpstreamModels(upstreamModels),
          modelMappingsJson: serializeKeyModelMappings(normalizedModelMappings),
          defaultModel: defaultProfile.model,
          supportsVision: defaultProfile.supportsVision,
          visionModel: defaultProfile.supportsVision ? null : defaultProfile.visionModel,
          dynamicModelSwitch: payload.dynamicModelSwitch,
          contextSwitchThreshold: payload.contextSwitchThreshold,
          contextOverflowModel: payload.contextOverflowModel?.trim() || null,
          activeModelOverride: payload.activeModelOverride?.trim() || null,
          timeoutMs: upstreamChannel?.timeoutMs ?? payload.timeoutMs,
          enabled: payload.enabled
        },
        include: {
          upstreamChannel: {
            select: KEY_WITH_CHANNEL_SELECT
          }
        }
      });
      clearGatewayKeyCache(created.localKey);

      return NextResponse.json(gatewayKeyDto(created), { status: 201 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          {
            error: "localKey already exists. Use another local key."
          },
          { status: 409 }
        );
      }
      const detail = error instanceof Error ? error.message : "Unknown error";
      const unknownArgMatch = detail.match(/Unknown argument `([^`]+)`/);
      if (unknownArgMatch) {
        const field = unknownArgMatch[1];
        return NextResponse.json(
          {
            error: `创建失败：当前 Prisma Client 缺少字段「${field}」。请先执行 npm run prisma:generate，并重启 next dev。`
          },
          { status: 500 }
        );
      }
      console.error("[api/keys POST] failed", error);
      return NextResponse.json(
        {
          error: `创建失败（服务端）: ${detail}`
        },
        { status: 500 }
      );
    }
  });
}
