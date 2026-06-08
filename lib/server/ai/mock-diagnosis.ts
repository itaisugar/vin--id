import "server-only";

import type {
  DiagnosisResult,
  LikelyCause,
  Recommendation,
  SafeToDrive,
  SafetyLevel,
} from "@/lib/diagnosis/types";

/**
 * MOCK_AI diagnosis provider — deterministic keyword rules, NO real AI, NO
 * network, NO API key. It returns the SAME structured schema a future real
 * provider will use, so swapping providers later is isolated to this file.
 *
 * Safety stance (conservative by design):
 *   - Brakes / steering / fuel / smoke / burning / severe electrical /
 *     overheating / tire failure are never told "safe to drive = yes".
 *   - The mock NEVER returns safe_to_drive = "yes" (it cannot certify safety).
 *   - No manufacturer-specific specs and no risky repair instructions.
 *
 * TODO(real-ai-provider): add a real provider behind the same interface,
 *   selected by MOCK_AI. TODO(image-diagnosis), TODO(streaming),
 *   TODO(source-citations), TODO(mechanic-handoff).
 */

type Locale = "en" | "he";

type CategoryKey =
  | "steering"
  | "fuel"
  | "smoke"
  | "electrical"
  | "overheating"
  | "brakes"
  | "tire"
  | "battery"
  | "noise"
  | "general";

interface CategoryContent {
  causes: LikelyCause[];
  checks: string[];
  whenToContact: string;
}

// Keyword sets (EN + HE). Order below defines priority (most dangerous first).
const KEYWORDS: Record<Exclude<CategoryKey, "general">, string[]> = {
  steering: ["steer", "steering", "הגה", "היגוי"],
  fuel: ["fuel", "petrol", "gas smell", "smell of gas", "דלק", "בנזין"],
  smoke: ["smoke", "burning", "burnt", "עשן", "שריפה", "נשרף", "שורף"],
  electrical: ["spark", "short circuit", "wiring", "ניצוץ", "קצר", "חיווט"],
  overheating: [
    "overheat",
    "temperature",
    "temp gauge",
    "coolant",
    "steam",
    "חום",
    "מתחמם",
    "התחממות",
    "אדים",
  ],
  brakes: ["brake", "braking", "squeal", "squeak", "בלם", "בלמים", "בלימה", "חריק"],
  tire: ["tire", "tyre", "flat", "blowout", "צמיג", "תקר"],
  battery: [
    "battery",
    "won't start",
    "wont start",
    "not starting",
    "no start",
    "dead",
    "crank",
    "מצבר",
    "לא מתניע",
    "לא נדלק",
  ],
  noise: [
    "noise",
    "tick",
    "ticking",
    "knock",
    "rattle",
    "clunk",
    "רעש",
    "תקתוק",
    "נקישה",
  ],
};

const DANGER_WORDS: Partial<Record<CategoryKey, string[]>> = {
  brakes: ["grind", "metal", "no brake", "fail", "soft pedal", "floor", "חריקת מתכת", "לא תופס"],
  overheating: ["steam", "smoke", "boiling", "red", "אדים", "רותח"],
  tire: ["blowout", "burst", "loss of control", "shred", "פיצוץ", "איבוד שליטה"],
  noise: ["knock", "clunk", "bang", "נקישה", "חבטה"],
};

function classify(symptoms: string): {
  category: CategoryKey;
  safety_level: SafetyLevel;
} {
  const s = symptoms.toLowerCase();
  const hasAny = (words: string[]) => words.some((w) => s.includes(w));

  const order: Exclude<CategoryKey, "general">[] = [
    "steering",
    "fuel",
    "smoke",
    "electrical",
    "overheating",
    "brakes",
    "tire",
    "battery",
    "noise",
  ];

  for (const category of order) {
    if (!hasAny(KEYWORDS[category])) continue;
    const danger = hasAny(DANGER_WORDS[category] ?? []);

    switch (category) {
      case "steering":
      case "fuel":
      case "smoke":
      case "electrical":
        return { category, safety_level: "stop_immediately" };
      case "overheating":
        return { category, safety_level: danger ? "stop_immediately" : "urgent" };
      case "brakes":
        return { category, safety_level: danger ? "stop_immediately" : "mechanic_recommended" };
      case "tire":
        return { category, safety_level: danger ? "stop_immediately" : "mechanic_recommended" };
      case "battery":
        return { category, safety_level: "mechanic_recommended" };
      case "noise":
        return { category, safety_level: danger ? "mechanic_recommended" : "monitor" };
    }
  }

  return { category: "general", safety_level: "monitor" };
}

function safeToDrive(level: SafetyLevel): SafeToDrive {
  // The mock never certifies "yes".
  return level === "urgent" || level === "stop_immediately" ? "no" : "unknown";
}

function recommendationFor(level: SafetyLevel): Recommendation {
  switch (level) {
    case "stop_immediately":
      return "stop";
    case "urgent":
      return "urgent";
    case "mechanic_recommended":
      return "mechanic";
    default:
      return "diy";
  }
}

// ---------------------------------------------------------------------------
// Localized content per category.
// ---------------------------------------------------------------------------
const SUMMARY_PREFIX: Record<Locale, string> = {
  en: "Based on what you described",
  he: "בהתבסס על מה שתיארת",
};

const DISCLAIMER: Record<Locale, string> = {
  en: "This is guidance only and does not replace a qualified mechanic.",
  he: "זוהי הנחיה כללית בלבד ואינה מחליפה מכונאי מוסמך.",
};

const CONTENT: Record<Locale, Record<CategoryKey, CategoryContent>> = {
  en: {
    steering: {
      causes: [{ title: "Steering system problem", explanation: "Steering issues can indicate a serious mechanical or hydraulic fault.", likelihood: "medium" }],
      checks: ["Do not drive. Pull over safely if you are driving.", "Note any unusual resistance, looseness, or noise."],
      whenToContact: "Contact a mechanic now and have the vehicle inspected before driving.",
    },
    fuel: {
      causes: [{ title: "Possible fuel leak or fumes", explanation: "A fuel smell or leak is a fire and safety hazard.", likelihood: "medium" }],
      checks: ["Stop the engine and move away from the vehicle.", "Avoid sparks, flames, and smoking near the vehicle."],
      whenToContact: "Contact a mechanic or roadside assistance immediately. Do not drive.",
    },
    smoke: {
      causes: [{ title: "Smoke or burning smell", explanation: "Smoke or a burning smell can indicate fire risk or a failing component.", likelihood: "medium" }],
      checks: ["Stop safely and turn off the engine.", "Leave the vehicle if you see smoke or flames."],
      whenToContact: "Contact emergency or roadside services immediately. Do not continue driving.",
    },
    electrical: {
      causes: [{ title: "Electrical fault", explanation: "Sparks, shorts, or an electrical burning smell can cause fire.", likelihood: "medium" }],
      checks: ["Stop safely and turn off the engine.", "Do not touch exposed wiring."],
      whenToContact: "Have a mechanic inspect the electrical system before driving.",
    },
    overheating: {
      causes: [{ title: "Engine overheating / cooling issue", explanation: "Overheating can quickly cause serious engine damage.", likelihood: "medium" }],
      checks: ["If the temperature gauge is high, stop safely and turn off the engine.", "Let the engine cool. Do not open a hot radiator cap."],
      whenToContact: "Contact a mechanic before driving further if it overheats.",
    },
    brakes: {
      causes: [
        { title: "Brake wear or fault", explanation: "Noises or reduced braking can mean worn pads or a brake-system issue.", likelihood: "medium" },
      ],
      checks: ["Note when the noise/feel happens (light vs hard braking).", "Avoid hard driving until checked."],
      whenToContact: "Have the brakes inspected by a mechanic soon.",
    },
    tire: {
      causes: [{ title: "Tire problem", explanation: "Tire damage or low pressure affects control and safety.", likelihood: "medium" }],
      checks: ["Check tire pressure and look for visible damage.", "Reduce speed and avoid sudden maneuvers."],
      whenToContact: "Have the tire inspected or replaced before longer drives.",
    },
    battery: {
      causes: [{ title: "Battery or starting issue", explanation: "Hard starting can point to the battery, alternator, or starter.", likelihood: "medium" }],
      checks: ["Check whether lights/electronics are weak.", "Try again after a short wait; note any clicking."],
      whenToContact: "Have the battery and charging system tested by a mechanic.",
    },
    noise: {
      causes: [{ title: "Unusual noise", explanation: "A new noise may be minor or an early sign of wear.", likelihood: "low" }],
      checks: ["Note when it happens (cold start, turning, braking, speed).", "Record a short audio clip if you can."],
      whenToContact: "If it worsens or is accompanied by warning lights, see a mechanic.",
    },
    general: {
      causes: [{ title: "Unclear from the description", explanation: "More detail is needed to narrow down possible causes.", likelihood: "low" }],
      checks: ["Note when the symptom happens and any warning lights.", "Add details like sounds, smells, or vibration."],
      whenToContact: "If the symptom worsens or a warning light appears, contact a mechanic.",
    },
  },
  he: {
    steering: {
      causes: [{ title: "בעיה במערכת ההיגוי", explanation: "תקלות היגוי עלולות להעיד על תקלה מכנית או הידראולית חמורה.", likelihood: "medium" }],
      checks: ["אל תיסע. אם אתה נוהג, עצור בבטחה בצד.", "שים לב להתנגדות, רפיון או רעש חריגים."],
      whenToContact: "פנה למכונאי מיד ובדוק את הרכב לפני נסיעה.",
    },
    fuel: {
      causes: [{ title: "חשד לדליפת דלק או אדי דלק", explanation: "ריח דלק או דליפה מהווים סכנת אש ובטיחות.", likelihood: "medium" }],
      checks: ["כבה את המנוע והתרחק מהרכב.", "הימנע מניצוצות, אש ועישון בקרבת הרכב."],
      whenToContact: "פנה מיד למכונאי או לגרר. אל תיסע.",
    },
    smoke: {
      causes: [{ title: "עשן או ריח שריפה", explanation: "עשן או ריח שריפה עלולים להצביע על סכנת אש או רכיב תקול.", likelihood: "medium" }],
      checks: ["עצור בבטחה וכבה את המנוע.", "צא מהרכב אם אתה רואה עשן או אש."],
      whenToContact: "פנה מיד לשירותי חירום או גרר. אל תמשיך בנסיעה.",
    },
    electrical: {
      causes: [{ title: "תקלה חשמלית", explanation: "ניצוצות, קצר או ריח חשמלי שרוף עלולים לגרום לאש.", likelihood: "medium" }],
      checks: ["עצור בבטחה וכבה את המנוע.", "אל תיגע בחיווט חשוף."],
      whenToContact: "תן למכונאי לבדוק את מערכת החשמל לפני נסיעה.",
    },
    overheating: {
      causes: [{ title: "התחממות מנוע / בעיית קירור", explanation: "התחממות יתר עלולה לגרום במהירות לנזק חמור למנוע.", likelihood: "medium" }],
      checks: ["אם מד החום גבוה, עצור בבטחה וכבה את המנוע.", "תן למנוע להתקרר. אל תפתח מכסה רדיאטור חם."],
      whenToContact: "פנה למכונאי לפני המשך נסיעה אם הרכב מתחמם.",
    },
    brakes: {
      causes: [{ title: "שחיקה או תקלה בבלמים", explanation: "רעשים או בלימה חלשה עלולים להעיד על רפידות שחוקות או תקלה במערכת.", likelihood: "medium" }],
      checks: ["שים לב מתי מופיע הרעש/התחושה (בלימה קלה מול חזקה).", "הימנע מנהיגה אגרסיבית עד לבדיקה."],
      whenToContact: "בדוק את הבלמים אצל מכונאי בהקדם.",
    },
    tire: {
      causes: [{ title: "בעיית צמיג", explanation: "נזק לצמיג או לחץ נמוך משפיעים על השליטה והבטיחות.", likelihood: "medium" }],
      checks: ["בדוק לחץ אוויר וחפש נזק גלוי.", "האט והימנע מתמרונים פתאומיים."],
      whenToContact: "בדוק או החלף את הצמיג לפני נסיעות ארוכות.",
    },
    battery: {
      causes: [{ title: "בעיית מצבר או התנעה", explanation: "התנעה קשה עשויה להצביע על מצבר, אלטרנטור או סטרטר.", likelihood: "medium" }],
      checks: ["בדוק אם התאורה/אלקטרוניקה חלשות.", "נסה שוב לאחר המתנה קצרה; שים לב לנקישות."],
      whenToContact: "בדוק את המצבר ומערכת הטעינה אצל מכונאי.",
    },
    noise: {
      causes: [{ title: "רעש חריג", explanation: "רעש חדש עשוי להיות זניח או סימן מוקדם לשחיקה.", likelihood: "low" }],
      checks: ["שים לב מתי זה קורה (התנעה קרה, פנייה, בלימה, מהירות).", "הקלט קטע אודיו קצר אם אפשר."],
      whenToContact: "אם זה מחמיר או מלווה בנוריות אזהרה, פנה למכונאי.",
    },
    general: {
      causes: [{ title: "לא ברור מהתיאור", explanation: "נדרשים פרטים נוספים כדי לצמצם את הסיבות האפשריות.", likelihood: "low" }],
      checks: ["שים לב מתי מופיע הסימפטום ולנוריות אזהרה.", "הוסף פרטים כמו רעשים, ריחות או רעידות."],
      whenToContact: "אם הסימפטום מחמיר או מופיעה נורית אזהרה, פנה למכונאי.",
    },
  },
};

export interface MockDiagnosisInput {
  symptoms: string;
  mileage?: number | null;
  locale?: string;
}

/** Run the deterministic mock diagnosis. Pure given (symptoms, locale). */
export function runMockDiagnosis(input: MockDiagnosisInput): DiagnosisResult {
  const locale: Locale = input.locale === "he" ? "he" : "en";
  const symptoms = input.symptoms.trim();

  const { category, safety_level } = classify(symptoms);
  const content = CONTENT[locale][category];

  const summary =
    locale === "he"
      ? `${SUMMARY_PREFIX.he}: "${symptoms}".`
      : `${SUMMARY_PREFIX.en}: "${symptoms}".`;

  const dangerous =
    safety_level === "urgent" || safety_level === "stop_immediately";

  return {
    symptom_summary: summary,
    likely_causes: content.causes,
    safety_level,
    safe_to_drive: safeToDrive(safety_level),
    step_by_step_checks: content.checks,
    when_to_stop_and_contact_mechanic: content.whenToContact,
    confidence_level:
      category === "general" ? "low" : dangerous ? "medium" : "low",
    recommendation: recommendationFor(safety_level),
    disclaimer: DISCLAIMER[locale],
    mock_mode: true,
  };
}
