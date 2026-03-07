import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { resolveUpstreamBaseUrl, UPSTREAM_WIRE_APIS } from "@/lib/key-config";
import { extractAnthropicMessageText } from "@/lib/anthropic-compat";
import { normalizeUpstreamModelCode, PROVIDERS, sanitizeBaseUrl } from "@/lib/providers";
import { extractLegacyChatCompletionText, extractResponseText } from "@/lib/mapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION?.trim() || "2023-06-01";

const testUpstreamSchema = z.object({
  id: z.number().int().positive().optional(),
  provider: z.enum(PROVIDERS),
  upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS),
  upstreamBaseUrl: z.string().url().optional(),
  upstreamApiKey: z.string().max(4096).optional(),
  clearUpstreamApiKey: z.boolean().optional(),
  defaultModel: z.string().min(1).max(256),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  testPrompt: z
    .string()
    .min(1)
    .max(2000)
    .default("请只回复：upstream_test_ok")
});

async function parseUpstreamBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json().catch(() => ({}));
  }
  return {
    raw: await response.text().catch(() => "")
  };
}

function previewString(value: unknown, maxLen = 220) {
  if (typeof value === "string") {
    return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return "";
    }
    return serialized.length > maxLen ? `${serialized.slice(0, maxLen)}...` : serialized;
  } catch {
    return String(value);
  }
}

function buildUpstreamEndpoint(
  baseUrl: string,
  resourcePath: "responses" | "chat/completions" | "messages"
) {
  const normalized = sanitizeBaseUrl(baseUrl);
  if (/\/v\d+(?:\.\d+)?$/i.test(normalized)) {
    return `${normalized}/${resourcePath}`;
  }
  return `${normalized}/v1/${resourcePath}`;
}

function buildRequestBody(upstreamWireApi: (typeof UPSTREAM_WIRE_APIS)[number], model: string, testPrompt: string) {
  if (upstreamWireApi === "responses") {
    return {
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: testPrompt }]
        }
      ],
      max_output_tokens: 80
    };
  }
  if (upstreamWireApi === "anthropic_messages") {
    return {
      model,
      messages: [{ role: "user", content: testPrompt }],
      max_tokens: 80
    };
  }
  return {
    model,
    messages: [{ role: "user", content: testPrompt }],
    max_tokens: 80
  };
}

function buildRequestHeaders(upstreamWireApi: (typeof UPSTREAM_WIRE_APIS)[number], upstreamApiKey: string): Record<string, string> {
  if (upstreamWireApi === "anthropic_messages") {
    return {
      "content-type": "application/json",
      "x-api-key": upstreamApiKey,
      "anthropic-version": DEFAULT_ANTHROPIC_VERSION
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${upstreamApiKey}`
  };
}

function extractResponsePreview(upstreamWireApi: (typeof UPSTREAM_WIRE_APIS)[number], upstreamBody: unknown) {
  if (upstreamWireApi === "responses") {
    return extractResponseText(upstreamBody).trim();
  }
  if (upstreamWireApi === "anthropic_messages") {
    return extractAnthropicMessageText(upstreamBody).trim();
  }
  return extractLegacyChatCompletionText(upstreamBody).trim();
}

export async function POST(req: Request) {
  return withApiLog(req, "POST /api/keys/test-upstream", async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = testUpstreamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid test upstream payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const existing = payload.id
      ? await prisma.providerKey.findUnique({ where: { id: payload.id } })
      : null;

    const nextUpstreamApiKey =
      payload.clearUpstreamApiKey === true
        ? null
        : payload.upstreamApiKey?.trim() || existing?.upstreamApiKey || null;
    if (!nextUpstreamApiKey) {
      return NextResponse.json(
        { error: "Missing upstream API key. Fill it in current form or save key first." },
        { status: 400 }
      );
    }

    let upstreamBaseUrl: string;
    try {
      upstreamBaseUrl = resolveUpstreamBaseUrl(payload.provider, payload.upstreamBaseUrl);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid upstream base url." },
        { status: 400 }
      );
    }

    const model = normalizeUpstreamModelCode(payload.provider, payload.defaultModel);
    const requestBody = buildRequestBody(payload.upstreamWireApi, model, payload.testPrompt);
    const endpoint = buildUpstreamEndpoint(
      upstreamBaseUrl,
      payload.upstreamWireApi === "responses"
        ? "responses"
        : payload.upstreamWireApi === "anthropic_messages"
          ? "messages"
          : "chat/completions"
    );

    const startAt = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: buildRequestHeaders(payload.upstreamWireApi, nextUpstreamApiKey),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(payload.timeoutMs)
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Failed to request upstream endpoint.",
          detail: error instanceof Error ? error.message : String(error)
        },
        { status: 504 }
      );
    }

    const latencyMs = Date.now() - startAt;
    const upstreamBody = await parseUpstreamBody(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Upstream model test failed.",
          upstreamStatus: response.status,
          latencyMs,
          upstreamPreview: previewString(upstreamBody, 420)
        },
        { status: 502 }
      );
    }

    const outputText = extractResponsePreview(payload.upstreamWireApi, upstreamBody);

    return NextResponse.json({
      ok: true,
      testedAt: new Date().toISOString(),
      latencyMs,
      provider: payload.provider,
      upstreamWireApi: payload.upstreamWireApi,
      model,
      promptPreview: previewString(payload.testPrompt, 120),
      responsePreview: outputText || previewString(upstreamBody, 300)
    });
  });
}
