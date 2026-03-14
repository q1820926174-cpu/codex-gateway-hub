import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import {
  createCodexExportBundle,
  parseCodexApplyPatchToolType,
  type CodexApplyPatchToolType
} from "@/lib/codex-export";
import { gatewayKeyDto } from "@/lib/key-config";

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

function parseApplyPatchToolType(
  value: string | null
): CodexApplyPatchToolType | null {
  if (value === null) {
    return "function";
  }
  return parseCodexApplyPatchToolType(value);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "GET /api/keys/:id/codex-export", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }

    const url = new URL(req.url);
    const applyPatchToolType = parseApplyPatchToolType(
      url.searchParams.get("applyPatchToolType")
    );
    if (!applyPatchToolType) {
      return NextResponse.json(
        { error: 'applyPatchToolType must be "function" or "freeform".' },
        { status: 400 }
      );
    }

    const key = await prisma.providerKey.findUnique({
      where: { id },
      include: KEY_WITH_CHANNEL_INCLUDE
    });
    if (!key) {
      return NextResponse.json({ error: "Key not found." }, { status: 404 });
    }

    const dto = gatewayKeyDto(key);
    const origin = url.origin.replace(/\/+$/, "");

    return NextResponse.json(
      createCodexExportBundle({
        localKey: dto.localKey,
        provider: dto.provider,
        providerName: dto.name,
        gatewayEndpoint: `${origin}/v1`,
        preferredModel:
          dto.activeModelOverride?.trim() || dto.defaultModel || "gpt-4.1-mini",
        modelPool: dto.upstreamModels.map((item) => ({
          model: item.model,
          aliasModel: item.aliasModel,
          contextWindow: item.contextWindow,
          enabled: item.enabled
        })),
        applyPatchToolType
      })
    );
  });
}
