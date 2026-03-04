import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/config", async () => {
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
      aiCallLogApi: "/api/call-logs"
    });
  });
}

export async function PUT(req: Request) {
  return withApiLog(req, "PUT /api/config", async () =>
    NextResponse.json(
      {
        error: "Use /api/keys and /api/upstreams to manage local keys and upstream channels."
      },
      { status: 410 }
    )
  );
}
