import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import { getPromptLabRunWithReport, scorePromptLabThresholds } from "@/lib/prompt-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  return withApiLog(req, "GET /api/prompt-lab/runs/:id/report", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const { id } = await props.params;
    const run = await getPromptLabRunWithReport(id);
    if (!run) {
      return NextResponse.json({ error: "Prompt lab run not found." }, { status: 404 });
    }
    if (!run.report) {
      return NextResponse.json(
        {
          error: "Prompt lab report is not ready yet.",
          status: run.status
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      report: run.report,
      thresholds: scorePromptLabThresholds(run.report.metrics)
    });
  });
}

