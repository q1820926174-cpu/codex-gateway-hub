import { NextResponse } from "next/server";
import {
  createOpenAiFile,
  deleteOpenAiFile,
  getOpenAiFile,
  listOpenAiFiles,
  OpenAiFileStoreError,
  readOpenAiFileContent
} from "@/lib/openai-file-store";
import { resolveGatewayKey } from "@/lib/upstream";

function errorJson(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function handleFileStoreError(error: unknown) {
  if (error instanceof OpenAiFileStoreError) {
    return errorJson(error.status, error.message);
  }
  return errorJson(500, error instanceof Error ? error.message : "Internal server error.");
}

async function resolveRequestKey(req: Request) {
  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );

  if (!resolved.ok) {
    return {
      ok: false as const,
      response: errorJson(resolved.status, resolved.body.error)
    };
  }

  return {
    ok: true as const,
    key: resolved.key
  };
}

export async function handleListFiles(req: Request) {
  const resolved = await resolveRequestKey(req);
  if (!resolved.ok) {
    return resolved.response;
  }

  const url = new URL(req.url);
  const purposeFilter = url.searchParams.get("purpose")?.trim().toLowerCase() || "";

  try {
    const allFiles = await listOpenAiFiles(resolved.key.id);
    const data = purposeFilter
      ? allFiles.filter((file) => file.purpose.toLowerCase() === purposeFilter)
      : allFiles;

    return NextResponse.json({
      object: "list",
      data,
      has_more: false
    });
  } catch (error) {
    return handleFileStoreError(error);
  }
}

export async function handleCreateFile(req: Request) {
  const resolved = await resolveRequestKey(req);
  if (!resolved.ok) {
    return resolved.response;
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorJson(400, "Invalid multipart/form-data payload.");
  }

  const filePart = formData.get("file");
  if (!(filePart instanceof File)) {
    return errorJson(400, "Missing file field in multipart form data.");
  }

  const purposeValue = formData.get("purpose");
  const purpose = typeof purposeValue === "string" ? purposeValue : undefined;

  try {
    const bytes = Buffer.from(await filePart.arrayBuffer());
    const created = await createOpenAiFile({
      ownerKeyId: resolved.key.id,
      filename: filePart.name || "upload.bin",
      purpose,
      mimeType: filePart.type || null,
      bytes
    });
    return NextResponse.json(created);
  } catch (error) {
    return handleFileStoreError(error);
  }
}

export async function handleGetFile(req: Request, fileId: string) {
  const resolved = await resolveRequestKey(req);
  if (!resolved.ok) {
    return resolved.response;
  }

  try {
    const file = await getOpenAiFile(resolved.key.id, fileId);
    if (!file) {
      return errorJson(404, "File not found.");
    }
    return NextResponse.json(file);
  } catch (error) {
    return handleFileStoreError(error);
  }
}

export async function handleDeleteFile(req: Request, fileId: string) {
  const resolved = await resolveRequestKey(req);
  if (!resolved.ok) {
    return resolved.response;
  }

  try {
    const file = await deleteOpenAiFile(resolved.key.id, fileId);
    if (!file) {
      return errorJson(404, "File not found.");
    }
    return NextResponse.json({
      id: file.id,
      object: "file",
      deleted: true
    });
  } catch (error) {
    return handleFileStoreError(error);
  }
}

export async function handleGetFileContent(req: Request, fileId: string) {
  const resolved = await resolveRequestKey(req);
  if (!resolved.ok) {
    return resolved.response;
  }

  try {
    const content = await readOpenAiFileContent(resolved.key.id, fileId);
    if (!content) {
      return errorJson(404, "File not found.");
    }

    const headers = new Headers();
    headers.set("content-type", content.mimeType || "application/octet-stream");
    headers.set("content-length", String(content.bytes.length));
    headers.set("content-disposition", `attachment; filename=\"${content.file.filename}\"`);

    return new Response(content.bytes, {
      status: 200,
      headers
    });
  } catch (error) {
    return handleFileStoreError(error);
  }
}
