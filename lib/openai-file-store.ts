import crypto from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type OpenAiFileObject = {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status: "processed";
  status_details: null;
};

export type OpenAiFileMediaType = "image" | "video" | "other";

export type OpenAiFileDataUrlResolved = {
  dataUrl: string;
  mimeType: string;
  mediaType: OpenAiFileMediaType;
};

type StoredFileMeta = OpenAiFileObject & {
  owner_key_id: number;
  mime_type: string | null;
};

const FILE_ID_RE = /^file-[a-zA-Z0-9]{12,64}$/;
const DEFAULT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_DATA_URL_MAX_BYTES = 20 * 1024 * 1024;

function parsePositiveIntEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const OPENAI_FILE_UPLOAD_MAX_BYTES = parsePositiveIntEnv(
  process.env.OPENAI_FILE_UPLOAD_MAX_BYTES,
  DEFAULT_UPLOAD_MAX_BYTES,
  1,
  100 * 1024 * 1024
);

const OPENAI_FILE_DATA_URL_MAX_BYTES = parsePositiveIntEnv(
  process.env.OPENAI_FILE_DATA_URL_MAX_BYTES,
  DEFAULT_DATA_URL_MAX_BYTES,
  1,
  100 * 1024 * 1024
);

export class OpenAiFileStoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAiFileStoreError";
    this.status = status;
  }
}

function resolveStorageRootDir() {
  const custom = process.env.OPENAI_FILE_STORAGE_DIR?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  }
  return path.resolve(process.cwd(), "data", "openai-files");
}

function resolveMetaDir() {
  return path.join(resolveStorageRootDir(), "meta");
}

function resolveBlobDir() {
  return path.join(resolveStorageRootDir(), "blob");
}

function resolveMetaPath(fileId: string) {
  return path.join(resolveMetaDir(), `${fileId}.json`);
}

function resolveBlobPath(fileId: string) {
  return path.join(resolveBlobDir(), `${fileId}.bin`);
}

let ensureStorageDirsPromise: Promise<void> | null = null;

async function ensureStorageDirs() {
  if (!ensureStorageDirsPromise) {
    ensureStorageDirsPromise = Promise.all([
      mkdir(resolveMetaDir(), { recursive: true }),
      mkdir(resolveBlobDir(), { recursive: true })
    ])
      .then(() => undefined)
      .catch((error) => {
        ensureStorageDirsPromise = null;
        throw error;
      });
  }
  await ensureStorageDirsPromise;
}

function isValidFileId(fileId: string) {
  return FILE_ID_RE.test(fileId.trim());
}

function normalizeFileId(fileId: string) {
  const normalized = fileId.trim();
  if (!isValidFileId(normalized)) {
    throw new OpenAiFileStoreError(400, "Invalid file id.");
  }
  return normalized;
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename || "upload.bin").trim();
  if (!base) {
    return "upload.bin";
  }
  const sanitized = base.replace(/[\r\n\\/]+/g, "_").slice(0, 180).trim();
  return sanitized || "upload.bin";
}

function normalizePurpose(purpose: string | undefined) {
  const trimmed = purpose?.trim();
  return trimmed ? trimmed.slice(0, 80) : "assistants";
}

function toPublicFile(meta: StoredFileMeta): OpenAiFileObject {
  return {
    id: meta.id,
    object: "file",
    bytes: meta.bytes,
    created_at: meta.created_at,
    filename: meta.filename,
    purpose: meta.purpose,
    status: "processed",
    status_details: null
  };
}

function parseStoredMeta(raw: string): StoredFileMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFileMeta>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      typeof parsed.id !== "string" ||
      !isValidFileId(parsed.id) ||
      parsed.object !== "file" ||
      typeof parsed.bytes !== "number" ||
      !Number.isFinite(parsed.bytes) ||
      parsed.bytes < 0 ||
      typeof parsed.created_at !== "number" ||
      !Number.isFinite(parsed.created_at) ||
      typeof parsed.filename !== "string" ||
      typeof parsed.purpose !== "string" ||
      typeof parsed.owner_key_id !== "number" ||
      !Number.isFinite(parsed.owner_key_id)
    ) {
      return null;
    }

    const mimeType =
      typeof parsed.mime_type === "string" && parsed.mime_type.trim()
        ? parsed.mime_type.trim().toLowerCase()
        : null;

    return {
      id: parsed.id,
      object: "file",
      bytes: Math.max(0, Math.floor(parsed.bytes)),
      created_at: Math.max(0, Math.floor(parsed.created_at)),
      filename: parsed.filename,
      purpose: parsed.purpose,
      status: "processed",
      status_details: null,
      owner_key_id: Math.max(1, Math.floor(parsed.owner_key_id)),
      mime_type: mimeType
    };
  } catch {
    return null;
  }
}

async function readMeta(fileId: string): Promise<StoredFileMeta | null> {
  const normalized = normalizeFileId(fileId);
  await ensureStorageDirs();
  try {
    const raw = await readFile(resolveMetaPath(normalized), "utf8");
    return parseStoredMeta(raw);
  } catch {
    return null;
  }
}

function buildFileId() {
  return `file-${crypto.randomUUID().replace(/-/g, "")}`;
}

async function ensureFileIdNotTaken(fileId: string) {
  try {
    await stat(resolveMetaPath(fileId));
    return false;
  } catch {
    return true;
  }
}

async function allocateFileId() {
  for (let i = 0; i < 6; i += 1) {
    const candidate = buildFileId();
    if (await ensureFileIdNotTaken(candidate)) {
      return candidate;
    }
  }
  throw new OpenAiFileStoreError(500, "Failed to allocate file id.");
}

export async function createOpenAiFile(params: {
  ownerKeyId: number;
  filename: string;
  purpose?: string;
  mimeType?: string | null;
  bytes: Buffer;
}) {
  await ensureStorageDirs();

  if (!Number.isFinite(params.ownerKeyId) || params.ownerKeyId <= 0) {
    throw new OpenAiFileStoreError(400, "Invalid key context for file upload.");
  }

  if (params.bytes.length <= 0) {
    throw new OpenAiFileStoreError(400, "Uploaded file is empty.");
  }

  if (params.bytes.length > OPENAI_FILE_UPLOAD_MAX_BYTES) {
    throw new OpenAiFileStoreError(
      413,
      `Uploaded file too large. Max ${OPENAI_FILE_UPLOAD_MAX_BYTES} bytes.`
    );
  }

  const fileId = await allocateFileId();
  const meta: StoredFileMeta = {
    id: fileId,
    object: "file",
    bytes: params.bytes.length,
    created_at: Math.floor(Date.now() / 1000),
    filename: sanitizeFilename(params.filename),
    purpose: normalizePurpose(params.purpose),
    status: "processed",
    status_details: null,
    owner_key_id: Math.floor(params.ownerKeyId),
    mime_type:
      typeof params.mimeType === "string" && params.mimeType.trim()
        ? params.mimeType.trim().toLowerCase()
        : null
  };

  const metaPath = resolveMetaPath(fileId);
  const blobPath = resolveBlobPath(fileId);

  try {
    await writeFile(blobPath, params.bytes);
    await writeFile(metaPath, JSON.stringify(meta), "utf8");
  } catch (error) {
    await rm(blobPath, { force: true }).catch(() => {});
    await rm(metaPath, { force: true }).catch(() => {});
    throw error;
  }

  return toPublicFile(meta);
}

export async function listOpenAiFiles(ownerKeyId: number): Promise<OpenAiFileObject[]> {
  await ensureStorageDirs();

  const entries = await readdir(resolveMetaDir(), { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          const raw = await readFile(path.join(resolveMetaDir(), entry.name), "utf8");
          return parseStoredMeta(raw);
        } catch {
          return null;
        }
      })
  );

  return files
    .filter((meta): meta is StoredFileMeta => meta !== null)
    .filter((meta) => meta.owner_key_id === ownerKeyId)
    .sort((a, b) => b.created_at - a.created_at)
    .map((meta) => toPublicFile(meta));
}

export async function getOpenAiFile(ownerKeyId: number, fileId: string): Promise<OpenAiFileObject | null> {
  const meta = await readMeta(fileId);
  if (!meta || meta.owner_key_id !== ownerKeyId) {
    return null;
  }
  return toPublicFile(meta);
}

export async function deleteOpenAiFile(ownerKeyId: number, fileId: string): Promise<OpenAiFileObject | null> {
  const normalized = normalizeFileId(fileId);
  const meta = await readMeta(normalized);
  if (!meta || meta.owner_key_id !== ownerKeyId) {
    return null;
  }

  await Promise.all([
    rm(resolveMetaPath(normalized), { force: true }),
    rm(resolveBlobPath(normalized), { force: true })
  ]).catch(() => {});

  return toPublicFile(meta);
}

export async function readOpenAiFileContent(ownerKeyId: number, fileId: string) {
  const normalized = normalizeFileId(fileId);
  const meta = await readMeta(normalized);
  if (!meta || meta.owner_key_id !== ownerKeyId) {
    return null;
  }

  try {
    const bytes = await readFile(resolveBlobPath(normalized));
    return {
      file: toPublicFile(meta),
      bytes,
      mimeType: meta.mime_type ?? "application/octet-stream"
    };
  } catch {
    return null;
  }
}

function classifyMediaTypeByMime(mimeType: string): OpenAiFileMediaType {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  return "other";
}

export async function resolveOpenAiFileIdToDataUrl(
  ownerKeyId: number,
  fileId: string
): Promise<OpenAiFileDataUrlResolved> {
  const content = await readOpenAiFileContent(ownerKeyId, fileId);
  if (!content) {
    throw new OpenAiFileStoreError(404, `File not found: ${fileId}`);
  }

  if (content.bytes.length > OPENAI_FILE_DATA_URL_MAX_BYTES) {
    throw new OpenAiFileStoreError(
      413,
      `File too large to inline as data URL. Max ${OPENAI_FILE_DATA_URL_MAX_BYTES} bytes.`
    );
  }

  const mimeType = content.mimeType?.trim().toLowerCase() || "application/octet-stream";
  return {
    dataUrl: `data:${mimeType};base64,${content.bytes.toString("base64")}`,
    mimeType,
    mediaType: classifyMediaTypeByMime(mimeType)
  };
}

export async function resolveOpenAiImageFileIdToDataUrl(ownerKeyId: number, fileId: string) {
  const resolved = await resolveOpenAiFileIdToDataUrl(ownerKeyId, fileId);
  if (resolved.mediaType !== "image") {
    throw new OpenAiFileStoreError(400, `File is not an image: ${fileId}`);
  }
  return resolved.dataUrl;
}
