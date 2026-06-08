"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { PassportSnapshot } from "@/lib/passports/types";

/** Read-only timeline preview of the frozen snapshot records. */
export function PassportTimeline({ snapshot }: { snapshot: PassportSnapshot }) {
  const t = useTranslations("passports");
  const tm = useTranslations("maintenance");
  const ti = useTranslations("issues");
  const td = useTranslations("documents");
  const tr = useTranslations("reminders");
  const tu = useTranslations("vehicles");
  const locale = useLocale();

  const unit = snapshot.vehicle.mileage_unit;
  const fmtDate = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(d),
        )
      : null;
  const fmtMoney = (amount: number | null, currency: string | null) =>
    amount != null
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: currency || "ILS",
          maximumFractionDigits: 2,
        }).format(amount)
      : null;
  const fmtMileage = (m: number | null) =>
    m != null ? `${m.toLocaleString(locale)} ${tu(`units.${unit}`)}` : null;

  return (
    <div className="space-y-6">
      {/* Maintenance */}
      {snapshot.included_scopes.includes("maintenance") ? (
        <Group title={`${tm("title")} (${snapshot.maintenance.length})`}>
          {snapshot.maintenance.length === 0 ? (
            <Empty text={t("timeline.emptyScope")} />
          ) : (
            snapshot.maintenance.map((m) => (
              <Row key={m.id}>
                <Line
                  meta={[fmtDate(m.date), fmtMileage(m.mileage), m.category]}
                  badge={tm(`trustLevels.${m.trust_level}`)}
                />
                {m.description ? <Body>{m.description}</Body> : null}
                {fmtMoney(m.cost, m.currency) ? (
                  <Body>{fmtMoney(m.cost, m.currency)}</Body>
                ) : null}
              </Row>
            ))
          )}
        </Group>
      ) : null}

      {/* Issues */}
      {snapshot.included_scopes.includes("issues") ? (
        <Group title={`${ti("title")} (${snapshot.issues.length})`}>
          {snapshot.issues.length === 0 ? (
            <Empty text={t("timeline.emptyScope")} />
          ) : (
            snapshot.issues.map((i) => (
              <Row key={i.id}>
                <Line
                  meta={[
                    fmtDate(i.date),
                    fmtMileage(i.mileage),
                    ti(`statuses.${i.status}`),
                    ti(`severities.${i.severity}`),
                  ]}
                  badge={ti(`trustLevels.${i.trust_level}`)}
                />
                {i.symptoms ? <Body>{i.symptoms}</Body> : null}
                {i.resolution_notes ? (
                  <Body>
                    {ti("resolutionPrefix")}: {i.resolution_notes}
                  </Body>
                ) : null}
              </Row>
            ))
          )}
        </Group>
      ) : null}

      {/* Documents (metadata only) */}
      {snapshot.included_scopes.includes("documents") ? (
        <Group title={`${td("title")} (${snapshot.documents.length})`}>
          {snapshot.documents.length === 0 ? (
            <Empty text={t("timeline.emptyScope")} />
          ) : (
            snapshot.documents.map((d) => (
              <Row key={d.id}>
                <Line
                  meta={[
                    d.file_name,
                    td(`documentTypes.${d.document_type}`),
                    fmtDate(d.document_date),
                    d.vendor,
                    fmtMoney(d.amount, d.currency),
                  ]}
                  badge={td(`trustLevels.${d.trust_level}`)}
                />
                {d.contains_personal_info ? (
                  <div>
                    <Badge tone="warning">{td("badges.personalInfo")}</Badge>
                  </div>
                ) : null}
              </Row>
            ))
          )}
        </Group>
      ) : null}

      {/* Reminders */}
      {snapshot.included_scopes.includes("reminders") ? (
        <Group title={`${tr("title")} (${snapshot.reminders.length})`}>
          {snapshot.reminders.length === 0 ? (
            <Empty text={t("timeline.emptyScope")} />
          ) : (
            snapshot.reminders.map((r) => (
              <Row key={r.id}>
                <Line
                  meta={[
                    r.title,
                    tr(`types.${r.reminder_type}`),
                    fmtDate(r.due_date),
                    fmtMileage(r.due_mileage),
                  ]}
                  badge={tr(`urgencies.${r.urgency}`)}
                />
                {r.description ? <Body>{r.description}</Body> : null}
              </Row>
            ))
          )}
        </Group>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border border-border p-3">
      {children}
    </div>
  );
}

function Line({
  meta,
  badge,
}: {
  meta: (string | null | undefined)[];
  badge?: string;
}) {
  const text = meta.filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-sm font-medium">{text}</span>
      {badge ? <Badge tone="muted">{badge}</Badge> : null}
    </div>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
