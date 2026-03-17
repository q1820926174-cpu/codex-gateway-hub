import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import { resolveCompatPromptHintDebugForModel } from "@/lib/compat-config";
import type { RulePreviewResult } from "@/lib/prompt-lab-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  provider: z.string().trim().max(200).optional(),
  upstreamModel: z.string().trim().max(256).optional(),
  clientModel: z.string().trim().max(256).optional()
});

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/prompt-lab/rule-preview", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const body = await req.json().catch(() => ({}));
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid rule preview payload." },
        { status: 400 }
      );
    }

    const debug = resolveCompatPromptHintDebugForModel({
      provider: parsed.data.provider ?? "",
      upstreamModel: parsed.data.upstreamModel ?? "",
      clientModel: parsed.data.clientModel ?? ""
    });

    const result: RulePreviewResult = {
      matchedRuleId: debug.matchedRuleId,
      matchedRuleIndex: debug.matchedRuleIndex,
      matchedExemption: debug.matchedExemption,
      matchedExemptionIndex: debug.matchedExemptionIndex,
      scoreBreakdown: debug.scoreBreakdown
        ? {
            providerRank: debug.scoreBreakdown.providerRank,
            upstreamRank: debug.scoreBreakdown.upstreamRank,
            hasProvider: debug.scoreBreakdown.hasProvider,
            hasUpstream: debug.scoreBreakdown.hasUpstream,
            score: debug.scoreBreakdown.score
          }
        : null,
      hintSource: debug.hintSource,
      hintPreview: debug.hint
    };

    return NextResponse.json(result);
  });
}
