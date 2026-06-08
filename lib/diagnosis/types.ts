import * as z from "zod";

// -----------------------------------------------------------------------------
// Enums (shared by the mock provider and any future real provider)
// -----------------------------------------------------------------------------
/** Safety levels — identical to issue_logs severity, so it maps 1:1. */
export const SAFETY_LEVELS = [
  "info",
  "monitor",
  "diy_simple",
  "mechanic_recommended",
  "urgent",
  "stop_immediately",
] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export const SAFE_TO_DRIVE = ["yes", "no", "unknown"] as const;
export type SafeToDrive = (typeof SAFE_TO_DRIVE)[number];

export const LIKELIHOODS = ["low", "medium", "high"] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const RECOMMENDATIONS = ["diy", "mechanic", "urgent", "stop"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const DIAGNOSIS_SESSION_STATUSES = ["active", "closed"] as const;
export type DiagnosisSessionStatus =
  (typeof DIAGNOSIS_SESSION_STATUSES)[number];

/** Marker stored on issues created from a mock diagnosis. */
export const DIAGNOSIS_SOURCE_TYPE = "mock_ai_diagnosis";

// -----------------------------------------------------------------------------
// Structured diagnosis result (the provider output schema)
// -----------------------------------------------------------------------------
export interface LikelyCause {
  title: string;
  explanation: string;
  likelihood: Likelihood;
}

export interface DiagnosisResult {
  symptom_summary: string;
  likely_causes: LikelyCause[];
  safety_level: SafetyLevel;
  safe_to_drive: SafeToDrive;
  step_by_step_checks: string[];
  when_to_stop_and_contact_mechanic: string;
  confidence_level: ConfidenceLevel;
  recommendation: Recommendation;
  disclaimer: string;
  mock_mode: true;
}

/** Zod schema to validate provider output / stored metadata defensively. */
export const diagnosisResultSchema = z.object({
  symptom_summary: z.string(),
  likely_causes: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      likelihood: z.enum(LIKELIHOODS),
    }),
  ),
  safety_level: z.enum(SAFETY_LEVELS),
  safe_to_drive: z.enum(SAFE_TO_DRIVE),
  step_by_step_checks: z.array(z.string()),
  when_to_stop_and_contact_mechanic: z.string(),
  confidence_level: z.enum(CONFIDENCE_LEVELS),
  recommendation: z.enum(RECOMMENDATIONS),
  disclaimer: z.string(),
  mock_mode: z.literal(true),
});

/** Metadata stored on the assistant diagnosis_messages row. */
export interface DiagnosisMessageMetadata {
  diagnosis: DiagnosisResult;
  mileage: number | null;
}

// -----------------------------------------------------------------------------
// Input validation (start a diagnosis)
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const diagnosisInputSchema = z.object({
  vehicleId: z.uuid({ error: "vehicleRequired" }),
  symptoms: z
    .string({ error: "symptomsRequired" })
    .trim()
    .min(3, { error: "symptomsRequired" })
    .max(2000, { error: "tooLong" }),
  mileage: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "invalidMileage" })
      .int({ error: "invalidMileage" })
      .min(0, { error: "invalidMileage" })
      .max(10_000_000, { error: "invalidMileage" })
      .optional(),
  ),
});
export type DiagnosisInput = z.infer<typeof diagnosisInputSchema>;

export interface DiagnosisFormValues {
  vehicleId: string;
  symptoms: string;
  mileage: string;
}

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------
export interface DiagnosisSession {
  id: string;
  owner_user_id: string;
  vehicle_id: string | null;
  title: string | null;
  status: DiagnosisSessionStatus;
  mode: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiagnosisMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** The diagnosis safety_level maps directly onto an issue severity. */
export function safetyLevelToIssueSeverity(level: SafetyLevel): SafetyLevel {
  return level;
}
