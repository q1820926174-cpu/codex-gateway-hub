import { handleResponses } from "@/lib/compat-handlers";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/v1/responses", () =>
    handleResponses(req, "/api/v1/responses")
  );
}
