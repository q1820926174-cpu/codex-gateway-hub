import type { ZodTypeAny } from "zod";

/**
 * Parse API payload with a provided zod schema and surface readable context on failure.
 */
export function parseApiContract(
  schema: ZodTypeAny,
  payload: unknown,
  context = "API response"
) {
  const result = schema.safeParse(payload);
  if (result.success) {
    return result.data;
  }
  const issue =
    result.error.issues[0]?.message || result.error.message || "Contract validation failed";
  throw new Error(`${context}: ${issue}`);
}

/**
 * This project currently treats API schemas as opt-in at call sites.
 * Return null here so fetchJson uses direct payload when no explicit schema is provided.
 */
export function resolveApiResponseSchema(_url: string, _method?: string): ZodTypeAny | null {
  return null;
}
