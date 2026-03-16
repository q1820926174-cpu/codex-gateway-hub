import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import {
  getPromptLabQueueSnapshot,
  getPromptLabRun,
  getPromptLabRunWithReport,
  summarizePromptLabFailures
} from "@/lib/prompt-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "GET /api/prompt-lab/runs/:id", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id } = await props.params;
    const run = await getPromptLabRun(id);
    if (!run) {
      return NextResponse.json({ error: "Prompt lab run not found." }, { status: 404 });
    }

    const withReport = await getPromptLabRunWithReport(id);
    const report = withReport?.report ?? null;
    const failureSummary = report ? summarizePromptLabFailures(report.failures) : { total: 0, byModel: [] };

    return NextResponse.json({
      ...run,
      queue: getPromptLabQueueSnapshot(),
      failureSummary
    });
  });
}

