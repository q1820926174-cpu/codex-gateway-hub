import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiLog } from "@/lib/api-log";
import { normalizeUpstreamWireApiValue, resolveUpstreamBaseUrl, UPSTREAM_WIRE_APIS } from "@/lib/key-config";
import { extractAnthropicMessageText } from "@/lib/anthropic-compat";
import { normalizeUpstreamModelCode, PROVIDERS, sanitizeBaseUrl } from "@/lib/providers";
import { extractLegacyChatCompletionText, extractResponseText } from "@/lib/mapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION?.trim() || "2023-06-01";

const testUpstreamSchema = z
  .object({
    channelId: z.number().int().positive().optional(),
    provider: z.enum(PROVIDERS).optional(),
    upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).optional(),
    upstreamBaseUrl: z.string().url().optional(),
    upstreamApiKey: z.string().max(4096).optional(),
    clearUpstreamApiKey: z.boolean().optional(),
    model: z.string().min(1).max(256).optional(),
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    testPrompt: z.string().min(1).max(2000).default("请只回复：upstream_test_ok")
  })
  .superRefine((value, ctx) => {
    if (!value.channelId && !value.provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provider"],
        message: "provider is required when channelId is not provided."
      });
    }
    if (!value.channelId && !value.upstreamWireApi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["upstreamWireApi"],
        message: "upstreamWireApi is required when channelId is not provided."
      });
    }
    if (!value.channelId && !value.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model"],
        message: "model is required when channelId is not provided."
      });
    }
  });

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
  return withApiLog(req, "POST /api/upstreams/test", async () => {
    const body = await req.json().catch(() => ({}));
    const parsed = testUpstreamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid upstream test payload",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const channel = payload.channelId
      ? await prisma.upstreamChannel.findUnique({
          where: { id: payload.channelId }
        })
      : null;
    if (payload.channelId && !channel) {
      return NextResponse.json({ error: "Upstream channel not found." }, { status: 404 });
    }

    const provider = payload.provider ?? (channel?.provider as (typeof PROVIDERS)[number] | undefined);
    if (!provider) {
      return NextResponse.json({ error: "provider is required." }, { status: 400 });
    }

    const upstreamWireApi = normalizeUpstreamWireApiValue(
      payload.upstreamWireApi ?? channel?.upstreamWireApi
    );
    const modelRaw = payload.model?.trim() || channel?.defaultModel || "";
    if (!modelRaw) {
      return NextResponse.json({ error: "model is required." }, { status: 400 });
    }
    const model = normalizeUpstreamModelCode(provider, modelRaw);
    const timeoutMs = payload.timeoutMs ?? channel?.timeoutMs ?? 60000;

    const upstreamApiKey =
      payload.clearUpstreamApiKey === true
        ? null
        : payload.upstreamApiKey?.trim() || channel?.upstreamApiKey?.trim() || null;
    if (!upstreamApiKey) {
      return NextResponse.json({ error: "Missing upstream API key." }, { status: 400 });
    }

    let upstreamBaseUrl: string;
    try {
      upstreamBaseUrl = resolveUpstreamBaseUrl(
        provider,
        payload.upstreamBaseUrl ?? channel?.upstreamBaseUrl
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid upstream base url." },
        { status: 400 }
      );
    }

    const requestBody = buildRequestBody(upstreamWireApi, model, payload.testPrompt);
    const endpoint = buildUpstreamEndpoint(
      upstreamBaseUrl,
      upstreamWireApi === "responses"
        ? "responses"
        : upstreamWireApi === "anthropic_messages"
          ? "messages"
          : "chat/completions"
    );

    const startAt = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: buildRequestHeaders(upstreamWireApi, upstreamApiKey),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs)
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

    const outputText = extractResponsePreview(upstreamWireApi, upstreamBody);

    return NextResponse.json({
      ok: true,
      testedAt: new Date().toISOString(),
      channelId: channel?.id ?? null,
      latencyMs,
      provider,
      upstreamWireApi,
      model,
      endpoint,
      promptPreview: previewString(payload.testPrompt, 120),
      responsePreview: outputText || previewString(upstreamBody, 300)
    });
  });
}
