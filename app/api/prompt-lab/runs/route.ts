import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import { createPromptLabRun, getPromptLabQueueSnapshot } from "@/lib/prompt-lab";
import type { PromptLabRunRequest } from "@/lib/prompt-lab-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createRunSchema = z
  .object({
    mode: z.enum(["cli", "import"]).default("cli"),
    baselineModel: z.string().trim().min(1).max(256).default("gpt-5.4"),
    candidateModels: z.array(z.string().trim().min(1).max(256)).max(12).default([]),
    suiteId: z.string().trim().min(1).max(80).default("tool-accuracy-v1"),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
    reportJson: z.unknown().optional()
  })
  .superRefine((value, ctx) => {
    if (value.mode === "import" && typeof value.reportJson === "undefined") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reportJson"],
        message: "reportJson is required when mode=import."
      });
    }
  });

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/prompt-lab/runs", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const payload = await req.json().catch(() => ({}));
    const parsed = createRunSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Invalid prompt lab payload."
        },
        { status: 400 }
      );
    }

    const request: PromptLabRunRequest = {
      mode: parsed.data.mode,
      baselineModel: parsed.data.baselineModel,
      candidateModels: parsed.data.candidateModels,
      suiteId: parsed.data.suiteId,
      sandbox: parsed.data.sandbox,
      reportJson: parsed.data.reportJson
    };

    const { run, initialize } = createPromptLabRun(request);
    await initialize();

    return NextResponse.json({
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt,
      queue: getPromptLabQueueSnapshot()
    });
  });
}

