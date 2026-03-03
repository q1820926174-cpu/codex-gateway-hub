import { NextResponse } from "next/server";
import { Prisma, type UpstreamChannel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import {
  ensureModelExistsInPool,
  gatewayKeyDto,
  normalizeKeyModelMappings,
  normalizeUpstreamModels,
  pickModelFromPool,
  resolveUpstreamBaseUrl,
  serializeKeyModelMappings,
  serializeUpstreamModels,
  updateGatewayKeySchema
} from "@/lib/key-config";
import { normalizeUpstreamModelCode, type ProviderName } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_WITH_CHANNEL_INCLUDE = {
  upstreamChannel: {
    select: {
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
    }
  }
} as const;

function parseId(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "GET /api/keys/:id", async () => {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const key = await prisma.providerKey.findUnique({
      where: { id },
      include: KEY_WITH_CHANNEL_INCLUDE
    });
    if (!key) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }

    return NextResponse.json(gatewayKeyDto(key));
  });
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "PUT /api/keys/:id", async () => {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = updateGatewayKeySchema.safeParse(body);
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
    const existing = await prisma.providerKey.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }

    const nextUpstreamChannelId =
      payload.upstreamChannelId === undefined
        ? existing.upstreamChannelId ?? null
        : payload.upstreamChannelId;
    let selectedChannel: UpstreamChannel | null = null;
    if (nextUpstreamChannelId !== null) {
      selectedChannel = await prisma.upstreamChannel.findUnique({
        where: { id: nextUpstreamChannelId }
      });
      if (!selectedChannel || !selectedChannel.enabled) {
        return NextResponse.json(
          {
            error: "Selected upstream channel not found or disabled."
          },
          { status: 400 }
        );
      }
    }

  const nextProvider = (selectedChannel?.provider ?? payload.provider ?? existing.provider) as ProviderName;
  let nextUpstreamBaseUrl = existing.upstreamBaseUrl;
  try {
    nextUpstreamBaseUrl = resolveUpstreamBaseUrl(
      nextProvider,
      selectedChannel?.upstreamBaseUrl ??
        (payload.upstreamBaseUrl ?? existing.upstreamBaseUrl)
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid upstream base url." },
      { status: 400 }
    );
  }

  let nextUpstreamApiKey = existing.upstreamApiKey;
  if (selectedChannel) {
    nextUpstreamApiKey = selectedChannel.upstreamApiKey;
  } else if (payload.clearUpstreamApiKey) {
    nextUpstreamApiKey = null;
  } else if (payload.upstreamApiKey !== undefined) {
    nextUpstreamApiKey = payload.upstreamApiKey.trim() || null;
  }

  let nextSupportsVision = selectedChannel?.supportsVision ?? payload.supportsVision ?? existing.supportsVision;
  let nextVisionModel = selectedChannel?.visionModel ?? existing.visionModel;
  if (!selectedChannel) {
    if (payload.clearVisionModel) {
      nextVisionModel = null;
    } else if (payload.visionModel !== undefined) {
      nextVisionModel = payload.visionModel.trim() || null;
    }
  }

  const nextDynamicModelSwitch =
    payload.dynamicModelSwitch ?? existing.dynamicModelSwitch;
  const nextContextSwitchThreshold =
    payload.contextSwitchThreshold ?? existing.contextSwitchThreshold;
  let nextContextOverflowModel = existing.contextOverflowModel;
  if (payload.clearContextOverflowModel) {
    nextContextOverflowModel = null;
  } else if (payload.contextOverflowModel !== undefined) {
    nextContextOverflowModel = payload.contextOverflowModel.trim() || null;
  }

  let nextActiveModelOverride = existing.activeModelOverride;
  if (payload.clearActiveModelOverride) {
    nextActiveModelOverride = null;
  } else if (payload.activeModelOverride !== undefined) {
    nextActiveModelOverride = payload.activeModelOverride.trim() || null;
  }
  const nextModelMappings =
    payload.modelMappings !== undefined
      ? normalizeKeyModelMappings(payload.modelMappings)
      : normalizeKeyModelMappings(existing.modelMappingsJson);
  const normalizedModelMappings = nextModelMappings.map((item) => ({
    ...item,
    targetModel: normalizeUpstreamModelCode(nextProvider, item.targetModel)
  }));

  const fallbackWireApi =
    (selectedChannel?.upstreamWireApi ?? payload.upstreamWireApi ?? existing.upstreamWireApi) === "chat_completions"
      ? "chat_completions"
      : "responses";
  const fallbackDefaultModel = selectedChannel?.defaultModel ?? payload.defaultModel?.trim() ?? existing.defaultModel;
  const fallbackVisionModel = nextVisionModel?.trim() || null;
  const existingPool = normalizeUpstreamModels(
    selectedChannel?.upstreamModelsJson ?? existing.upstreamModelsJson,
    {
      model: selectedChannel?.defaultModel ?? existing.defaultModel,
      upstreamWireApi:
        (selectedChannel?.upstreamWireApi ?? existing.upstreamWireApi) === "chat_completions"
          ? "chat_completions"
          : "responses",
      supportsVision: selectedChannel?.supportsVision ?? existing.supportsVision,
      visionModel: selectedChannel?.visionModel ?? existing.visionModel
    }
  );
  const candidatePool =
    !selectedChannel && payload.upstreamModels !== undefined
      ? normalizeUpstreamModels(payload.upstreamModels, {
          model: fallbackDefaultModel,
          upstreamWireApi: fallbackWireApi,
          supportsVision: nextSupportsVision,
          visionModel: fallbackVisionModel
        })
      : existingPool;
  const nextUpstreamModels = ensureModelExistsInPool(candidatePool, fallbackDefaultModel, {
    upstreamWireApi: fallbackWireApi,
    supportsVision: nextSupportsVision,
    visionModel: fallbackVisionModel
  });
  const nextDefaultProfile =
    pickModelFromPool(nextUpstreamModels, fallbackDefaultModel) ??
    nextUpstreamModels[0] ??
    null;
  if (!nextDefaultProfile) {
    return NextResponse.json(
      {
        error: "At least one upstream model is required."
      },
      { status: 400 }
    );
  }
  nextSupportsVision = nextDefaultProfile.supportsVision;
  nextVisionModel = nextDefaultProfile.supportsVision
    ? null
    : nextDefaultProfile.visionModel ?? null;
  const nextDefaultModel = nextDefaultProfile.model;
  const nextUpstreamWireApi = nextDefaultProfile.upstreamWireApi;

  if (nextDynamicModelSwitch && !nextContextOverflowModel) {
    return NextResponse.json(
      {
        error: "contextOverflowModel is required when dynamicModelSwitch is true."
      },
      { status: 400 }
    );
  }

    try {
      const updated = await prisma.providerKey.update({
        where: { id },
        data: {
          name: payload.name?.trim() ?? existing.name,
          localKey: payload.localKey?.trim() ?? existing.localKey,
          ...(nextUpstreamChannelId === null
            ? {
                upstreamChannel: {
                  disconnect: true
                }
              }
            : {
                upstreamChannel: {
                  connect: {
                    id: nextUpstreamChannelId
                  }
                }
              }),
          provider: nextProvider,
          wireApi: "responses",
          upstreamWireApi: nextUpstreamWireApi,
          upstreamBaseUrl: nextUpstreamBaseUrl,
          upstreamApiKey: nextUpstreamApiKey,
          upstreamModelsJson: serializeUpstreamModels(nextUpstreamModels),
          modelMappingsJson: serializeKeyModelMappings(normalizedModelMappings),
          defaultModel: nextDefaultModel,
          supportsVision: nextSupportsVision,
          visionModel: nextVisionModel,
          dynamicModelSwitch: nextDynamicModelSwitch,
          contextSwitchThreshold: nextContextSwitchThreshold,
          contextOverflowModel: nextContextOverflowModel,
          activeModelOverride: nextActiveModelOverride,
          timeoutMs: selectedChannel?.timeoutMs ?? payload.timeoutMs ?? existing.timeoutMs,
          enabled: payload.enabled ?? existing.enabled
        },
        include: KEY_WITH_CHANNEL_INCLUDE
      });

      return NextResponse.json(gatewayKeyDto(updated));
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
            error: `保存失败：当前 Prisma Client 缺少字段「${field}」。请先执行 npm run prisma:generate，并重启 next dev。`
          },
          { status: 500 }
        );
      }
      console.error("[api/keys/:id PUT] failed", error);
      return NextResponse.json(
        {
          error: `保存失败（服务端）: ${detail}`
        },
        { status: 500 }
      );
    }
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "DELETE /api/keys/:id", async () => {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const existing = await prisma.providerKey.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }

    await prisma.providerKey.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
