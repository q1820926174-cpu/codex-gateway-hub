import { appendApiLogEntry } from "@/lib/api-log-store";

// Maximum length for text previews in logs
// 日志中文本预览的最大长度
const MAX_TEXT_PREVIEW = 2000;
// Maximum body size to include in logs
// 日志中包含的最大请求体大小
const MAX_BODY_SIZE = 200_000;
// Regex pattern to detect sensitive header/field names
// 用于检测敏感头/字段名的正则表达式
const SENSITIVE_KEY_RE =
  /(authorization|api[-_]?key|token|secret|password|localkey|upstreamapikey|cookie|set-cookie)/i;
// Enable console logging of API requests/responses
// 是否启用 API 请求/响应的控制台日志
const ENABLE_CONSOLE_LOG =
  process.env.API_LOG_CONSOLE === "1" || process.env.API_LOG_CONSOLE === "true";
// Error message when preview fails
// 预览失败时的错误消息
const PREVIEW_ERROR_TEXT = "[preview failed]";

// Truncate text to maximum length with indicator
// 将文本截断到最大长度并添加指示
function truncate(text: string, max = MAX_TEXT_PREVIEW) {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...(+${text.length - max} chars)`;
}

// Mask secret values to prevent exposure in logs
// 掩码处理密钥值以防止在日志中暴露
function maskSecret(value: string) {
  if (!value) {
    return value;
  }
  if (value.length <= 8) {
    return "***";
  }
  // Show first 4 chars, mask middle, show last 2 chars
  // 显示前4个字符，掩码中间，显示最后2个字符
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

// Recursively redact sensitive data from unknown value
// 从未知值中递归脱敏敏感数据
function redactUnknown(value: unknown, depth = 0): unknown {
  // Limit recursion depth to prevent stack overflow
  // 限制递归深度以防止堆栈溢出
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
    // Mask sensitive fields
    // 掩码敏感字段
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = typeof val === "string" ? maskSecret(val) : "***";
      continue;
    }
    out[key] = redactUnknown(val, depth + 1);
  }
  return out;
}

// Safely stringify log data
// 安全地序列化日志数据
function stringifyLogData(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Redact sensitive information from headers
// 从请求头中脱敏敏感信息
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

// Create a preview of the request body with sensitive data redacted
// 创建请求体预览并脱敏敏感数据
async function requestBodyPreview(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  // Omit large bodies
  // 省略大体积请求体
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return `[body omitted: ${contentLength} bytes]`;
  }
  const contentType = req.headers.get("content-type") ?? "";
  // Omit multipart form data
  // 省略多部分表单数据
  if (contentType.includes("multipart/form-data")) {
    return "[multipart body omitted]";
  }
  // GET/HEAD requests have no body
  // GET/HEAD 请求没有请求体
  if (req.method === "GET" || req.method === "HEAD") {
    return "[no body]";
  }
  // Clone the request to read body without consuming it
  // 克隆请求以读取请求体而不消耗它
  const raw = await req.clone().text().catch(() => "");
  if (!raw) {
    return "[empty body]";
  }
  // Parse and redact JSON bodies
  // 解析并脱敏 JSON 请求体
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

// Create a preview of the response body with sensitive data redacted
// 创建响应体预览并脱敏敏感数据
async function responseBodyPreview(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  // Omit large bodies
  // 省略大体积响应体
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_SIZE) {
    return `[body omitted: ${contentLength} bytes]`;
  }
  const contentType = response.headers.get("content-type") ?? "";
  // Mark streaming responses specially
  // 特殊标记流式响应
  if (contentType.includes("text/event-stream")) {
    return "[stream: text/event-stream]";
  }
  // Omit non-text content types
  // 省略非文本内容类型
  if (!contentType.includes("application/json") && !contentType.includes("text/")) {
    return `[body omitted: ${contentType || "non-text"}]`;
  }
  // Clone the response to read body without consuming it
  // 克隆响应以读取响应体而不消耗它
  const raw = await response.clone().text().catch(() => "");
  if (!raw) {
    return "[empty body]";
  }
  // Parse and redact JSON bodies
  // 解析并脱敏 JSON 响应体
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

// Higher-order function to wrap API handlers with request/response logging
// 高阶函数，用请求/响应日志包装 API 处理器
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

  // Prepare request data for logging
  // 准备用于日志的请求数据
  const reqHeaders = req ? redactHeaders(req.headers) : {};
  const reqBodyPromise = req
    ? requestBodyPreview(req).catch(() => PREVIEW_ERROR_TEXT)
    : Promise.resolve("[no request object]");
  // Log to console if enabled
  // 如果启用则输出到控制台
  if (ENABLE_CONSOLE_LOG) {
    void reqBodyPromise
      .then((reqBody) => {
        if (req) {
          const reqLog = {
            route: routeName,
            method,
            path,
            headers: reqHeaders,
            body: reqBody
          };
          console.info(`[API][${requestId}] <=`, stringifyLogData(reqLog));
          return;
        }
        console.info(`[API][${requestId}] <=`, stringifyLogData({ route: routeName, method, path }));
      })
      .catch(() => {});
  }

  try {
    // Execute the actual handler
    // 执行实际的处理器
    const response = await handler();
    const elapsedMs = Date.now() - startedAt;
    const responseHeaders = redactHeaders(response.headers);
    const responseBodyPromise = responseBodyPreview(response).catch(() => PREVIEW_ERROR_TEXT);
    // Log success response asynchronously
    // 异步记录成功响应
    void (async () => {
      const [reqBody, responseBody] = await Promise.all([reqBodyPromise, responseBodyPromise]);
      const respLog = {
        route: routeName,
        method,
        path,
        status: response.status,
        elapsedMs,
        headers: responseHeaders,
        body: responseBody
      };
      if (ENABLE_CONSOLE_LOG) {
        console.info(`[API][${requestId}] =>`, stringifyLogData(respLog));
      }
      // Persist log to store
      // 将日志持久化到存储
      await appendApiLogEntry({
        id: requestId,
        route: routeName,
        method,
        path,
        status: response.status,
        elapsedMs,
        requestHeaders: reqHeaders,
        requestBody: reqBody,
        responseHeaders: responseHeaders,
        responseBody: responseBody,
        error: null,
        createdAt: new Date().toISOString()
      });
    })().catch(() => {});

    return response;
  } catch (error) {
    // Handle and log errors
    // 处理并记录错误
    const elapsedMs = Date.now() - startedAt;
    const detail = error instanceof Error ? error.message : String(error);
    void (async () => {
      const reqBody = await reqBodyPromise;
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
      // Persist error log to store
      // 将错误日志持久化到存储
      await appendApiLogEntry({
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
    })().catch(() => {});
    throw error;
  }
}
