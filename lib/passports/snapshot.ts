import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Stable canonical JSON serialization: object keys are sorted recursively so
 * the output is deterministic regardless of insertion order. Used as the input
 * to the snapshot hash so the hash only changes when content changes.
 *
 * NOTE: never feed signed URLs or raw storage paths into this — the snapshot is
 * built without them.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(",")}}`;
  }

  // string | number | boolean
  return JSON.stringify(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 (hex) of the canonical snapshot. */
export function hashSnapshot(snapshot: unknown): string {
  return sha256Hex(canonicalize(snapshot));
}

/**
 * Generate a secure transfer token. The raw token is returned ONCE (to build
 * the share URL); only the hash is persisted in transfer_tokens.token_hash.
 */
export function generateTransferToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}
