import { useTranslations } from "next-intl";

const RADIUS = 46;
const CIRC = 2 * Math.PI * RADIUS; // ≈ 289

// Tone by value — documentation quality, NOT condition. A low score must not
// read as a healthy green ring, so the stroke color tracks the value. The
// matching text color drives the drop-shadow glow (currentColor).
const STROKE: Record<"ok" | "warn" | "danger", string> = {
  ok: "stroke-ok text-ok",
  warn: "stroke-warn text-warn",
  danger: "stroke-danger text-danger",
};

/** Record Confidence Score gauge (ring). Documentation quality — NOT condition. */
export function ConfidenceScore({ score }: { score: number | null }) {
  const t = useTranslations("passports");
  const value = Math.max(0, Math.min(100, Math.round(score ?? 0)));
  const tone = value >= 70 ? "ok" : value >= 40 ? "warn" : "danger";
  const target = CIRC * (1 - value / 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            className="stroke-track"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={target}
            className={`${STROKE[tone]} animate-ring [filter:drop-shadow(0_0_6px_currentColor)]`}
            style={
              {
                "--ring-circ": `${CIRC}`,
                "--ring-target": `${target}`,
              } as React.CSSProperties
            }
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
            {t("confidence.title")}
          </span>
          <span className="num text-5xl font-bold leading-none text-ink">
            {value}
          </span>
          <span className="num text-[11px] text-ink-3">/ 100</span>
        </div>
      </div>
      <p className="max-w-xs text-center text-xs text-ink-2">
        {t("confidenceHelp")}
      </p>
    </div>
  );
}
