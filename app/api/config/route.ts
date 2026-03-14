import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import {
  getCompatPromptConfig,
  getCompatPromptDefaults,
  saveCompatPromptConfig
} from "@/lib/compat-config";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const compatPromptConfigSchema = z.object({
  agentsMdKeywords: z.array(z.string().trim().min(1).max(200)).min(1).max(32),
  chineseReplyHint: z.string().trim().min(1).max(20000)
});

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/config", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const [totalKeys, enabledKeys, totalChannels, enabledChannels] = await Promise.all([
      prisma.providerKey.count(),
      prisma.providerKey.count({
        where: { enabled: true }
      }),
      prisma.upstreamChannel.count(),
      prisma.upstreamChannel.count({
        where: { enabled: true }
      })
    ]);
    return NextResponse.json({
      wireApi: "responses",
      totalKeys,
      enabledKeys,
      totalChannels,
      enabledChannels,
      manageKeysApi: "/api/keys",
      manageUpstreamsApi: "/api/upstreams",
      usageReportApi: "/api/usage",
      aiCallLogApi: "/api/call-logs",
      compatPromptConfig: getCompatPromptConfig(),
      compatPromptDefaults: getCompatPromptDefaults()
    });
  });
}

export async function PUT(req: Request) {
  return withApiLog(req, "PUT /api/config", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const rawBody = (await req.json().catch(() => ({}))) as {
      compatPromptConfig?: unknown;
    };
    const parsed = compatPromptConfigSchema.safeParse(rawBody.compatPromptConfig ?? rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid config payload."
        },
        { status: 400 }
      );
    }

    const compatPromptConfig = await saveCompatPromptConfig(parsed.data);
    const [totalKeys, enabledKeys, totalChannels, enabledChannels] = await Promise.all([
      prisma.providerKey.count(),
      prisma.providerKey.count({
        where: { enabled: true }
      }),
      prisma.upstreamChannel.count(),
      prisma.upstreamChannel.count({
        where: { enabled: true }
      })
    ]);

    return NextResponse.json({
      wireApi: "responses",
      totalKeys,
      enabledKeys,
      totalChannels,
      enabledChannels,
      manageKeysApi: "/api/keys",
      manageUpstreamsApi: "/api/upstreams",
      usageReportApi: "/api/usage",
      aiCallLogApi: "/api/call-logs",
      compatPromptConfig,
      compatPromptDefaults: getCompatPromptDefaults()
    });
  });
}
