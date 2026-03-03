import { appendApiLogEntry } from "@/lib/api-log-store";

const MAX_TEXT_PREVIEW = 2000;
const MAX_BODY_SIZE = 200_000;
const SENSITIVE_KEY_RE =
  /(authorization|api[-_]?key|token|secret|password|localkey|upstreamapikey|cookie|set-cookie)/i;
const ENABLE_CONSOLE_LOG =
  process.env.API_LOG_CONSOLE === "1" || process.env.API_LOG_CONSOLE === "true";

function truncate(text: string, max = MAX_TEXT_PREVIEW) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...(+${text.length - max} chars)`;
}

function maskSecret(value: string) {
  if (!value) {
    return value;
  }
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[depth-limited]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = typeof val === "string" ? maskSecret(val) : "***";
      continue;
    }
    out[key] = redactUnknown(val, depth + 1);
  }
  return out;
}

function stringifyLogData(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = maskSecret(value);
      continue;
    }
    out[key] = truncate(value, 240);
  }
  return out;
}

async function requestBodyPreview(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return `[body omitted: ${contentLength} bytes]`;
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return "[multipart body omitted]";
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return "[no body]";
  }
  const raw = await req.clone().text().catch(() => "");
  if (!raw) {
    return "[empty body]";
  }
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return truncate(stringifyLogData(redactUnknown(parsed)));
    } catch {
      return truncate(raw);
    }
  }
  return truncate(raw);
}

async function responseBodyPreview(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return "[stream: text/event-stream]";
  }
  if (!contentType.includes("application/json") && !contentType.includes("text/")) {
    return `[body omitted: ${contentType || "non-text"}]`;
  }
  const raw = await response.clone().text().catch(() => "");
  if (!raw) {
    return "[empty body]";
  }
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return truncate(stringifyLogData(redactUnknown(parsed)));
    } catch {
      return truncate(raw);
    }
  }
  return truncate(raw);
}

export async function withApiLog(
  req: Request | undefined,
  routeName: string,
  handler: () => Promise<Response> | Response
) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const method = req?.method ?? routeName.split(" ")[0] ?? "UNKNOWN";
  const url = req ? new URL(req.url) : null;
  const path = url ? `${url.pathname}${url.search}` : routeName;

  const reqHeaders = req ? redactHeaders(req.headers) : {};
  const reqBody = req ? await requestBodyPreview(req) : "[no request object]";
  if (ENABLE_CONSOLE_LOG) {
    if (req) {
      const reqLog = {
        route: routeName,
        method,
        path,
        headers: reqHeaders,
        body: reqBody
      };
      console.info(`[API][${requestId}] <=`, stringifyLogData(reqLog));
    } else {
      console.info(`[API][${requestId}] <=`, stringifyLogData({ route: routeName, method, path }));
    }
  }

  try {
    const response = await handler();
    const elapsedMs = Date.now() - startedAt;
    const respLog = {
      route: routeName,
      method,
      path,
      status: response.status,
      elapsedMs,
      headers: redactHeaders(response.headers),
      body: await responseBodyPreview(response)
    };
    if (ENABLE_CONSOLE_LOG) {
      console.info(`[API][${requestId}] =>`, stringifyLogData(respLog));
    }
    void appendApiLogEntry({
      id: requestId,
      route: routeName,
      method,
      path,
      status: response.status,
      elapsedMs,
      requestHeaders: reqHeaders,
      requestBody: reqBody,
      responseHeaders: respLog.headers,
      responseBody: respLog.body,
      error: null,
      createdAt: new Date().toISOString()
    });
    return response;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const detail = error instanceof Error ? error.message : String(error);
    if (ENABLE_CONSOLE_LOG) {
      console.error(
        `[API][${requestId}] xx`,
        stringifyLogData({
          route: routeName,
          method,
          path,
          elapsedMs,
          error: detail
        })
      );
    }
    void appendApiLogEntry({
      id: requestId,
      route: routeName,
      method,
      path,
      status: null,
      elapsedMs,
      requestHeaders: reqHeaders,
      requestBody: reqBody,
      responseHeaders: {},
      responseBody: "",
      error: detail,
      createdAt: new Date().toISOString()
    });
    throw error;
  }
}
