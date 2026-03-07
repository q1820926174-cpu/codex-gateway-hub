import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import { PROVIDERS } from "@/lib/providers";
import { UPSTREAM_WIRE_APIS } from "@/lib/key-config";
import {
  createUpstreamChannelSchema,
  normalizeChannelPayload,
  upstreamChannelDto
} from "@/lib/upstream-channel-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/upstreams", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const channels = await prisma.upstreamChannel.findMany({
      include: {
        _count: {
          select: {
            keys: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }]
    });

    return NextResponse.json({
      items: channels.map(upstreamChannelDto),
      providers: PROVIDERS,
      upstreamWireApis: UPSTREAM_WIRE_APIS
    });
  });
}

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/upstreams", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const body = await req.json().catch(() => ({}));
    const parsed = createUpstreamChannelSchema.safeParse(body);
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
    let normalized;
    try {
      normalized = normalizeChannelPayload({
        provider: payload.provider,
        upstreamWireApi: payload.upstreamWireApi,
        upstreamBaseUrl: payload.upstreamBaseUrl,
        defaultModel: payload.defaultModel,
        supportsVision: payload.supportsVision,
        visionModel: payload.visionModel,
        upstreamModels: payload.upstreamModels
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid channel payload." },
        { status: 400 }
      );
    }

    const created = await prisma.upstreamChannel.create({
      data: {
        name: payload.name.trim(),
        provider: payload.provider,
        upstreamWireApi: normalized.upstreamWireApi,
        upstreamBaseUrl: normalized.upstreamBaseUrl,
        upstreamApiKey: payload.upstreamApiKey?.trim() || null,
        upstreamModelsJson: normalized.upstreamModelsJson,
        defaultModel: normalized.defaultModel,
        supportsVision: normalized.supportsVision,
        visionModel: normalized.visionModel,
        timeoutMs: payload.timeoutMs,
        enabled: payload.enabled
      }
    });

    return NextResponse.json(upstreamChannelDto(created), { status: 201 });
  });
}
