import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
/** Private Storage bucket name (see supabase/README.md). */
export const DOCUMENTS_BUCKET = "vehicle-documents";

/** DB column `doc_type` values (kept from the base schema). */
export const DOCUMENT_TYPES = [
  "invoice",
  "registration",
  "insurance",
  "inspection",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const CURRENCIES = ["ILS", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Product trust vocabulary (stored in DB column `trust_label`). */
export const TRUST_LEVELS = [
  "user_entered",
  "document_backed",
  "ai_extracted",
  "mechanic_verified",
  "external_source",
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const SELECTABLE_TRUST_LEVELS: TrustLevel[] = [
  "user_entered",
  "document_backed",
];

// -----------------------------------------------------------------------------
// File upload constraints
// -----------------------------------------------------------------------------
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Make a storage-safe filename: ASCII-ish, no path separators. */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/\\/g, "/").split("/").pop() ?? "file";
  const safe = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 120);
  return safe || "file";
}

// -----------------------------------------------------------------------------
// Row shape. DB column `doc_type` is exposed as `document_type` in the form.
// `storage_path` is internal — never rendered in the UI.
// -----------------------------------------------------------------------------
export interface VehicleDocument {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  doc_type: DocumentType;
  title: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  document_date: string | null;
  expiry_date: string | null;
  vendor: string | null;
  amount: number | null;
  currency: string;
  contains_personal_info: boolean;
  share_allowed: boolean;
  trust_label: TrustLevel;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const DOCUMENT_COLUMNS =
  "id, owner_user_id, vehicle_id, doc_type, title, storage_path, file_name, mime_type, file_size, document_date, expiry_date, vendor, amount, currency, contains_personal_info, share_allowed, trust_label, created_at, updated_at, deleted_at";

// -----------------------------------------------------------------------------
// Validation — error messages are translation keys (under `documents.form.errors`).
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { error: "invalidDate" })
    .optional(),
);

/** Editable metadata (shared by upload + edit forms and server validation). */
export const documentMetadataSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES).default("other"),
  document_date: optionalDate,
  expiry_date: optionalDate,
  vendor: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(120, { error: "tooLong" }).optional(),
  ),
  amount: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidAmount" })
      .min(0, { error: "invalidAmount" })
      .max(100_000_000, { error: "invalidAmount" })
      .optional(),
  ),
  currency: z.enum(CURRENCIES).default("ILS"),
  contains_personal_info: z.boolean().default(true),
  share_allowed: z.boolean().default(false),
  trust_label: z.enum(TRUST_LEVELS).default("document_backed"),
});

export type DocumentMetadataInput = z.infer<typeof documentMetadataSchema>;

/** Full create payload: metadata + the already-uploaded file descriptor. */
export const documentCreateSchema = documentMetadataSchema.extend({
  documentId: z.uuid({ error: "saveFailed" }),
  storage_path: z.string().min(1, { error: "saveFailed" }),
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME_TYPES, { error: "invalidFileType" }),
  file_size: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE, { error: "fileTooLarge" }),
});

export type DocumentCreateInput = z.infer<typeof documentCreateSchema>;

// -----------------------------------------------------------------------------
// Form values (React Hook Form) — metadata only; the file is handled separately.
// -----------------------------------------------------------------------------
export interface DocumentFormValues {
  document_type: DocumentType;
  document_date: string;
  expiry_date: string;
  vendor: string;
  amount: string;
  currency: Currency;
  contains_personal_info: boolean;
  share_allowed: boolean;
  trust_label: TrustLevel;
}

export function emptyDocumentForm(): DocumentFormValues {
  return {
    document_type: "other",
    document_date: "",
    expiry_date: "",
    vendor: "",
    amount: "",
    currency: "ILS",
    contains_personal_info: true,
    share_allowed: false,
    trust_label: "document_backed",
  };
}

export function documentToFormValues(d: VehicleDocument): DocumentFormValues {
  return {
    document_type: d.doc_type,
    document_date: d.document_date ?? "",
    expiry_date: d.expiry_date ?? "",
    vendor: d.vendor ?? "",
    amount: d.amount != null ? String(d.amount) : "",
    currency: (CURRENCIES as readonly string[]).includes(d.currency)
      ? (d.currency as Currency)
      : "ILS",
    contains_personal_info: d.contains_personal_info,
    share_allowed: d.share_allowed,
    trust_label: d.trust_label,
  };
}

/** Map validated metadata to DB columns (document_type -> doc_type). */
export function metadataToRow(meta: DocumentMetadataInput) {
  return {
    doc_type: meta.document_type,
    document_date: meta.document_date ?? null,
    expiry_date: meta.expiry_date ?? null,
    vendor: meta.vendor ?? null,
    amount: meta.amount ?? null,
    currency: meta.currency,
    contains_personal_info: meta.contains_personal_info,
    share_allowed: meta.share_allowed,
    trust_label: meta.trust_label,
  };
}
