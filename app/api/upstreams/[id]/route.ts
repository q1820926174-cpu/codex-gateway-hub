import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import {
  normalizeChannelPayload,
  updateUpstreamChannelSchema,
  upstreamChannelDto
} from "@/lib/upstream-channel-config";
import type { ProviderName } from "@/lib/providers";
import { normalizeUpstreamWireApiValue, type UpstreamWireApi } from "@/lib/key-config";
import { clearGatewayKeyCache } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return withApiLog(req, "GET /api/upstreams/:id", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const channel = await prisma.upstreamChannel.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            keys: true
          }
        }
      }
    });
    if (!channel) {
      return NextResponse.json({ error: "Upstream channel not found." }, { status: 404 });
    }

    return NextResponse.json(upstreamChannelDto(channel));
  });
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "PUT /api/upstreams/:id", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = updateUpstreamChannelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid upstream channel payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const existing = await prisma.upstreamChannel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Upstream channel not found." }, { status: 404 });
    }

    const nextProvider = (payload.provider ?? existing.provider) as ProviderName;
    const nextUpstreamWireApi = normalizeUpstreamWireApiValue(
      payload.upstreamWireApi ?? existing.upstreamWireApi
    );
    const normalizedNextUpstreamWireApi = nextUpstreamWireApi as UpstreamWireApi;
    const nextDefaultModel = payload.defaultModel?.trim() ?? existing.defaultModel;
    const nextSupportsVision = payload.supportsVision ?? existing.supportsVision;
    const nextVisionModel = payload.clearVisionModel
      ? null
      : payload.visionModel?.trim() ?? existing.visionModel;
    let parsedExistingModels: unknown = [];
    try {
      parsedExistingModels = JSON.parse(existing.upstreamModelsJson || "[]");
    } catch {
      parsedExistingModels = [];
    }
    const nextModelsRaw = payload.upstreamModels ?? parsedExistingModels;

    let normalized;
    try {
      normalized = normalizeChannelPayload({
        provider: nextProvider,
        upstreamWireApi: normalizedNextUpstreamWireApi,
        upstreamBaseUrl: payload.upstreamBaseUrl ?? existing.upstreamBaseUrl,
        defaultModel: nextDefaultModel,
        supportsVision: nextSupportsVision,
        visionModel: nextVisionModel,
        upstreamModels: nextModelsRaw
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid channel payload." },
        { status: 400 }
      );
    }

    const nextUpstreamApiKey =
      payload.clearUpstreamApiKey === true
        ? null
        : payload.upstreamApiKey?.trim() ?? existing.upstreamApiKey;

    const updated = await prisma.upstreamChannel.update({
      where: { id },
      data: {
        name: payload.name?.trim() ?? existing.name,
        provider: nextProvider,
        upstreamWireApi: normalized.upstreamWireApi,
        upstreamBaseUrl: normalized.upstreamBaseUrl,
        upstreamApiKey: nextUpstreamApiKey,
        upstreamModelsJson: normalized.upstreamModelsJson,
        defaultModel: normalized.defaultModel,
        supportsVision: normalized.supportsVision,
        visionModel: normalized.visionModel,
        timeoutMs: payload.timeoutMs ?? existing.timeoutMs,
        enabled: payload.enabled ?? existing.enabled
      },
      include: {
        _count: {
          select: {
            keys: true
          }
        }
      }
    });
    clearGatewayKeyCache();

    return NextResponse.json(upstreamChannelDto(updated));
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "DELETE /api/upstreams/:id", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const existing = await prisma.upstreamChannel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Upstream channel not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.providerKey.updateMany({
        where: { upstreamChannelId: id },
        data: { upstreamChannelId: null }
      }),
      prisma.upstreamChannel.delete({ where: { id } })
    ]);
    clearGatewayKeyCache();
    return NextResponse.json({ ok: true });
  });
}
