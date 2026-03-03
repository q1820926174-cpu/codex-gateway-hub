import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/config", async () => {
    const totalKeys = await prisma.providerKey.count();
    const enabledKeys = await prisma.providerKey.count({
      where: { enabled: true }
    });
    const totalChannels = await prisma.upstreamChannel.count();
    const enabledChannels = await prisma.upstreamChannel.count({
      where: { enabled: true }
    });
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
