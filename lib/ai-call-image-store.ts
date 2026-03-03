import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiCallLogImage } from "@/lib/ai-call-log-store";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

function normalizeSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    return "-";
  }
  if (trimmed.startsWith("data:")) {
    return "[data-url]";
  }
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname}`;
  } catch {
    return trimmed.length > 256 ? `${trimmed.slice(0, 256)}...` : trimmed;
  }
}

function resolveExtByMimeType(mimeType: string | null | undefined) {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized.includes("image/jpeg") || normalized.includes("image/jpg")) return "jpg";
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/gif")) return "gif";
  if (normalized.includes("image/bmp")) return "bmp";
  if (normalized.includes("image/svg")) return "svg";
  if (normalized.includes("image/tiff")) return "tiff";
  if (normalized.includes("image/avif")) return "avif";
  return null;
}

function resolveExtByUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const file = url.pathname.split("/").pop() ?? "";
    const lastDot = file.lastIndexOf(".");
    if (lastDot <= 0) {
      return null;
    }
    const ext = file.slice(lastDot + 1).toLowerCase();
    if (!/^[a-z0-9]{2,5}$/.test(ext)) {
      return null;
    }
    return ext;
  } catch {
    return null;
  }
}

function parseDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma <= 0) {
    return null;
  }
  const header = dataUrl.slice("data:".length, comma);
  const payload = dataUrl.slice(comma + 1);
  const mimePart = header.split(";")[0]?.trim().toLowerCase() || null;
  const isBase64 = header.toLowerCase().includes(";base64");

  try {
    if (isBase64) {
      return {
        mimeType: mimePart,
        buffer: Buffer.from(payload, "base64")
      };
    }
    return {
      mimeType: mimePart,
      buffer: Buffer.from(decodeURIComponent(payload), "utf8")
    };
  } catch {
    return null;
  }
}

async function saveImageBuffer(buffer: Buffer, ext: string) {
  const now = new Date();
  const dateFolder = [
    now.getFullYear().toString(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const filename = `img_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}.${ext}`;
  const imageDir = path.resolve(process.cwd(), "public", "ai-call-images", dateFolder);
  await mkdir(imageDir, { recursive: true });
  const absPath = path.join(imageDir, filename);
  await writeFile(absPath, buffer);
  return {
    absPath,
    savedUrl: `/ai-call-images/${dateFolder}/${filename}`
  };
}

function buildFailedImageRecord(params: {
  sourceType: AiCallLogImage["sourceType"];
  source: string;
  mimeType?: string | null;
  error: string;
}): AiCallLogImage {
  return {
    sourceType: params.sourceType,
    source: normalizeSource(params.source),
    savedUrl: null,
    mimeType: params.mimeType ?? null,
    sizeBytes: null,
    error: params.error.length > 240 ? `${params.error.slice(0, 240)}...` : params.error
  };
}

export async function persistAiCallImage(source: string): Promise<AiCallLogImage> {
  const trimmed = source.trim();
  if (!trimmed) {
    return buildFailedImageRecord({
      sourceType: "unsupported",
      source,
      error: "Empty image source."
    });
  }

  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed || parsed.buffer.length === 0) {
      return buildFailedImageRecord({
        sourceType: "data_url",
        source: trimmed,
        error: "Invalid data URL image payload."
      });
    }
    if (parsed.buffer.length > MAX_IMAGE_BYTES) {
      return buildFailedImageRecord({
        sourceType: "data_url",
        source: trimmed,
        mimeType: parsed.mimeType,
        error: `Image is too large (${parsed.buffer.length} bytes).`
      });
    }
    const ext = resolveExtByMimeType(parsed.mimeType) ?? "bin";
    const saved = await saveImageBuffer(parsed.buffer, ext);
    return {
      sourceType: "data_url",
      source: "[data-url]",
      savedUrl: saved.savedUrl,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.buffer.length
    };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return buildFailedImageRecord({
      sourceType: "unsupported",
      source: trimmed,
      error: "Only data URL and http(s) image source are supported."
    });
  }

  try {
    const response = await fetch(trimmed, {
      method: "GET",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      return buildFailedImageRecord({
        sourceType: "remote_url",
        source: trimmed,
        error: `Download failed (${response.status}).`
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      return buildFailedImageRecord({
        sourceType: "remote_url",
        source: trimmed,
        error: "Downloaded image is empty."
      });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return buildFailedImageRecord({
        sourceType: "remote_url",
        source: trimmed,
        error: `Image is too large (${buffer.length} bytes).`
      });
    }

    const contentTypeRaw = response.headers.get("content-type") ?? "";
    const mimeType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() || null;
    const ext = resolveExtByMimeType(mimeType) ?? resolveExtByUrl(trimmed) ?? "bin";
    const saved = await saveImageBuffer(buffer, ext);
    return {
      sourceType: "remote_url",
      source: normalizeSource(trimmed),
      savedUrl: saved.savedUrl,
      mimeType,
      sizeBytes: buffer.length
    };
  } catch (error) {
    return buildFailedImageRecord({
      sourceType: "remote_url",
      source: trimmed,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
