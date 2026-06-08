import * as z from "zod";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
export const REMINDER_TYPES = [
  "service",
  "inspection",
  "insurance",
  "registration",
  "tires",
  "battery",
  "custom",
] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const URGENCIES = ["green", "orange", "red"] as const;
export type Urgency = (typeof URGENCIES)[number];

/**
 * DB status values. The app presents 'pending' as "Active" (the base schema
 * uses 'pending'); see translations `reminders.statuses`.
 */
export const REMINDER_STATUSES = ["pending", "completed", "dismissed"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** The "active" status value in the DB. */
export const ACTIVE_STATUS: ReminderStatus = "pending";

/** Near-due mileage window (unit-agnostic) used to derive "soon" urgency. */
export const MILEAGE_SOON_WINDOW = 1000;
/** Due-soon window in days used to derive "soon" urgency. */
export const DUE_SOON_DAYS = 30;

// -----------------------------------------------------------------------------
// Row shape
// -----------------------------------------------------------------------------
export interface Reminder {
  id: string;
  owner_user_id: string;
  vehicle_id: string;
  title: string | null;
  description: string | null;
  reminder_type: ReminderType;
  due_date: string | null;
  due_mileage: number | null;
  urgency: Urgency;
  status: ReminderStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const REMINDER_COLUMNS =
  "id, owner_user_id, vehicle_id, title, description, reminder_type, due_date, due_mileage, urgency, status, completed_at, created_at, updated_at, deleted_at";

// -----------------------------------------------------------------------------
// Derived (effective) urgency — display only, never persisted.
// -----------------------------------------------------------------------------
const URGENCY_RANK: Record<Urgency, number> = { green: 1, orange: 2, red: 3 };

export function compareUrgency(a: Urgency, b: Urgency): number {
  return URGENCY_RANK[b] - URGENCY_RANK[a]; // most severe first
}

/**
 * Combine the stored urgency with state derived from due_date / due_mileage:
 * - overdue date or mileage at/over due -> red
 * - date within DUE_SOON_DAYS or mileage within MILEAGE_SOON_WINDOW -> orange
 * Returns the most severe of stored vs derived.
 */
export function deriveEffectiveUrgency(
  reminder: Pick<Reminder, "urgency" | "due_date" | "due_mileage">,
  currentMileage: number | null,
): Urgency {
  let level: Urgency = reminder.urgency;
  const bump = (to: Urgency) => {
    if (URGENCY_RANK[to] > URGENCY_RANK[level]) level = to;
  };

  if (reminder.due_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(reminder.due_date);
    const days = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) bump("red");
    else if (days <= DUE_SOON_DAYS) bump("orange");
  }

  if (reminder.due_mileage != null && currentMileage != null) {
    if (currentMileage >= reminder.due_mileage) bump("red");
    else if (reminder.due_mileage - currentMileage <= MILEAGE_SOON_WINDOW) {
      bump("orange");
    }
  }

  return level;
}

/** Sort key: most urgent first, then nearest due date, then nearest mileage. */
export function sortActiveReminders(
  reminders: Reminder[],
  currentMileage: number | null,
): Reminder[] {
  return [...reminders].sort((a, b) => {
    const ua = deriveEffectiveUrgency(a, currentMileage);
    const ub = deriveEffectiveUrgency(b, currentMileage);
    const byUrgency = compareUrgency(ua, ub);
    if (byUrgency !== 0) return byUrgency;

    const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
    const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;

    const ma = a.due_mileage ?? Number.POSITIVE_INFINITY;
    const mb = b.due_mileage ?? Number.POSITIVE_INFINITY;
    return ma - mb;
  });
}

// -----------------------------------------------------------------------------
// Validation — error messages are translation keys (under `reminders.form.errors`).
// -----------------------------------------------------------------------------
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const reminderInputSchema = z
  .object({
    title: z
      .string({ error: "required" })
      .trim()
      .min(1, { error: "required" })
      .max(120, { error: "tooLong" }),
    description: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(2000, { error: "tooLong" }).optional(),
    ),
    reminder_type: z.enum(REMINDER_TYPES).default("service"),
    due_date: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => !Number.isNaN(Date.parse(v)), { error: "invalidDate" })
        .optional(),
    ),
    due_mileage: z.preprocess(
      emptyToUndefined,
      z.coerce
        .number({ error: "invalidMileage" })
        .int({ error: "invalidMileage" })
        .min(0, { error: "invalidMileage" })
        .max(10_000_000, { error: "invalidMileage" })
        .optional(),
    ),
    urgency: z.enum(URGENCIES).default("green"),
    status: z.enum(REMINDER_STATUSES).default("pending"),
  })
  .refine((d) => d.due_date != null || d.due_mileage != null, {
    error: "dueRequired",
    path: ["due_date"],
  });

export type ReminderInput = z.infer<typeof reminderInputSchema>;

// -----------------------------------------------------------------------------
// Form values (React Hook Form)
// -----------------------------------------------------------------------------
export interface ReminderFormValues {
  title: string;
  description: string;
  reminder_type: ReminderType;
  due_date: string;
  due_mileage: string;
  urgency: Urgency;
  status: ReminderStatus;
}

export function emptyReminderForm(): ReminderFormValues {
  return {
    title: "",
    description: "",
    reminder_type: "service",
    due_date: "",
    due_mileage: "",
    urgency: "green",
    status: "pending",
  };
}

export function reminderToFormValues(r: Reminder): ReminderFormValues {
  return {
    title: r.title ?? "",
    description: r.description ?? "",
    reminder_type: r.reminder_type,
    due_date: r.due_date ?? "",
    due_mileage: r.due_mileage != null ? String(r.due_mileage) : "",
    urgency: r.urgency,
    status: r.status,
  };
}

/** Map validated input to DB columns. `completed_at` is managed by the service. */
export function reminderInputToRow(input: ReminderInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    reminder_type: input.reminder_type,
    due_date: input.due_date ?? null,
    due_mileage: input.due_mileage ?? null,
    urgency: input.urgency,
    status: input.status,
  };
}
