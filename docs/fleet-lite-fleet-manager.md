# Fleet Lite — the Fleet Manager layer

What the dashboard, vehicle list and vehicle detail actually compute, and the
rules behind every number on them.

## The question this layer answers

> What requires my attention today?

Every number on these screens comes from an organization-scoped database query.
There are no mock KPIs, no fabricated alerts and no hardcoded demo counts. Where
the data cannot support a figure, the UI says so rather than guessing.

## Alert rules

All thresholds live in `lib/fleet/alerts.ts` and `lib/fleet/dates.ts` — one
definition, shared by the dashboard, the list and the detail page, so the three
can never disagree.

| Rule | Threshold |
| --- | --- |
| Service overdue (date) | `next_service_date` before today |
| Service due soon (date) | within `DUE_SOON_DAYS` = **30** days |
| Service overdue (mileage) | `next_service_km` ≤ `current_mileage` |
| Service due soon (mileage) | within `DUE_SOON_KM` = **1000** of the target |
| Document expired | `expiry_date` before today |
| Document expiring soon | within `DOC_EXPIRING_DAYS` = **30** days |
| High-priority issue | severity ∈ `urgent`, `stop_immediately` |
| Repeated issues | ≥ `REPEATED_ISSUE_THRESHOLD` = **2** open issues |

A `next_service_km` **below** the current odometer is overdue, not invalid data.
A fleet that drove past its service interval is precisely what this product
exists to catch.

### Issues

Statuses and severities are the real values from the database CHECK constraints
— nothing is invented. Open = `open` or `monitoring`; `resolved` is excluded.
Severity ladder: `info`, `monitor`, `diy_simple`, `mechanic_recommended`,
`urgent`, `stop_immediately`.

### Operational status

`operational_status` is **stored, never inferred**. A vehicle explicitly marked
`out_of_service` stays that way even with clean deadlines, and a vehicle marked
`active` is never silently relabelled. Derived signals appear as their own
alerts *alongside* the stored status. Grouping:

- **operational** — `active`
- **attention** — `needs_service`, `issue_open`, `documents_missing`
- **unavailable** — `out_of_service`, `in_garage`

### Documents, and what is *not* claimed

A count of documents counts **document records**; a count of vehicles is named
for vehicles. One document = one expiring item: a vehicle's statutory test date,
its insurance date, or an uploaded `vehicle_documents` row with an expiry.

The previous dashboard tile read "Documents to handle" while counting *vehicles*
— it overstated outstanding paperwork. That tile is now split into
`documentsExpired` and `documentsExpiringSoon`, both counting documents.

**Missing documents are not claimed.** The schema has no per-organization policy
of which documents are required, so "missing" cannot be derived reliably. The
only honest signal is the explicit `operational_status = 'documents_missing'` a
human set, reported under its own name. No compliance percentage is fabricated.

## Costs

See the long-form rules at the top of `lib/fleet/costs.ts`. Summary:

**Source:** `maintenance_logs.cost` + `currency`, attributed by `performed_at`.
It is the only table pairing an amount with a service date.

Deliberately excluded: `issue_logs` has no cost column (repairs are recorded as
maintenance); `vehicle_documents.amount` would **double-count**, because a
maintenance log created from a scanned invoice carries `document_id` pointing at
that very document; `vehicle_insurance.cost` / `vehicle_inspection.cost` are
annual policy fields with no reliable spend date.

| Case | Treatment |
| --- | --- |
| Attribution date | `performed_at` |
| NULL `performed_at` | excluded; counted in `undatedCount` |
| NULL cost | excluded (unknown ≠ zero); counted in `unknownCostCount` |
| Zero cost | included — a real recorded value |
| Negative cost | excluded, counted in `invalidCount`; **DB now rejects new ones** |
| Duplicates | not de-duplicated — two logs are two records |
| Currency | **never converted**; summed per currency, dominant one reported, `mixedCurrency` flagged |

### Cost anomaly rule

Deterministic, stable, computed in TypeScript. A vehicle is unusually expensive
this month when **all** hold:

1. ≥ `COST_ANOMALY_MIN_VEHICLES` (**3**) vehicles recorded a cost this month;
2. its month cost ≥ `COST_ANOMALY_MULTIPLIER` (**2×**) the mean; and
3. its month cost ≥ `COST_ANOMALY_MIN_ABSOLUTE` (**1000**).

This is **not** an "AI anomaly" and is never labelled as one. No LLM is involved
anywhere in this layer.

## Dashboard

Five org-scoped queries, all joining/counting in memory — no N+1, no per-row
query, no signed URL per row. Only the current month of `maintenance_logs` is
fetched, so the cost roll-up never scans the whole service history.

**Tiles:** total vehicles · operational · need attention · service overdue ·
service due soon · documents expired · documents expiring · open issues · cost
this month. Each links to the filtered list that explains it.

**Action list** — one ordered list, urgency rank from `alerts.ts`:

1. overdue / expired / unavailable
2. urgent open issues
3. due soon / expiring / open issues
4. missing information
5. cost anomaly

Each vehicle contributes at most one action per problem area, so a vehicle with
five expired documents appears once instead of burying the fleet. Every row
names its vehicle and links to the record that resolves it.

**Insights** — deterministic only: highest-cost vehicle this month, a vehicle
with repeated open issues, and how many vehicles lack the data to compute a
service status. No generated prose.

**States:** loading, no organization, no vehicles (guides to adding the first),
no actions ("nothing needs attention today"), query error, and a mixed-currency
disclosure.

## Vehicle list

Columns: plate · make/model/year · type · driver · operational status · attention
chips · mileage · next service · nearest document expiry · open issues · cost
this month (hidden below `sm` to keep the mobile card readable) · link to the
vehicle, which links on to its Passport.

**Search** (`?q=`) matches plate, make, model, display name, type, driver and
VIN. Case- and whitespace-normalized. It runs **after** organization scoping, so
a search term can never surface another organization's vehicle — verified.

**Filters:** needs attention · service overdue · service due soon · documents ·
open issues · unassigned driver, plus the operational statuses (kept as valid
`?filter=` values so dashboard tiles deep-link into them). Cleared with one link.

**Sorts:** urgency (default) · vehicle name · plate · next service · nearest
expiry · cost this month · status · recently updated.

Filter, sort and search all live in the URL, so every view is shareable and the
page stays a server component.

### Performance

Validated at 50 vehicles + 6 in a decoy organization. Five queries total,
independent of fleet size. Indexes added for the new query patterns in
`20260725200000_fleet_manager_queries.sql`:
`maintenance_logs(organization_id, performed_at)`,
`vehicle_documents(organization_id, expiry_date)`,
`issue_logs(organization_id, status)`.

## Vehicle detail

`VehicleFleetStatus` adds the operational view above the existing card: service,
nearest document expiry, open issues, month cost, and the vehicle's own action
list. It reuses `getFleetVehicleDetail()`, which applies the same rules as the
dashboard, so the two screens cannot disagree. A forged vehicle id is simply
absent from the org-scoped set and resolves to `null`.

No duplicate edit flows are added — every line links to the existing
maintenance / issues / documents section that already owns that record.

**Data provenance** is labelled on each item: *Calculated*, *From records*, or
*Not set*. Nothing implies a document was verified when it was not.

## Permissions

`organization_members` is the source of truth (see
[fleet-lite-members-invitations.md](./fleet-lite-members-invitations.md)).

| | Dashboard | Vehicle ops | Members |
| --- | :-: | :-: | :-: |
| owner | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ |
| fleet_manager | ✅ | ✅ | — |
| viewer | read-only | — | — |
| non-member / removed | — | — | — |

Enforced by RLS, not by disabled buttons — validated by attempting real writes
through each persona's session, including a removed member carrying a stale
`profiles` cache.

## Validation

```bash
FLEET_CHECK_ALLOW=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… \
SUPABASE_SERVICE_ROLE_KEY=… npm run validate:fleet-manager
```

Same guards as the other harnesses: explicit opt-in, refuses the production ref
`jsthfmgvcdrfzpgkpwvt`, refuses non-local URLs without
`FLEET_CHECK_ALLOW_REMOTE=1`. Real per-persona sessions make every assertion;
the service role only builds fixtures. No secret is printed.

The harness imports `lib/fleet/costs.ts` **directly** (Node 24 strips types), so
it validates the shipped calculation rather than a reimplementation.

### The fixture

`scripts/validation/lib/fleet-fixture.mjs` builds one organization with 50
vehicles in real application tables — deterministic (every vehicle derived from
its index), with dates relative to today. Scenarios by `i % 10`: service overdue
by date · due soon by date · overdue by mileage · test expired · insurance
expiring · uploaded document expired · one open issue · two open issues incl.
urgent · incomplete data · clean. Costs: high (12,000) on the repeated-issue
vehicles as the intended anomaly, then low / mid / NULL by `i % 3`, plus a
previous-month cost on every vehicle to prove monthly attribution.

It is local-only, repeatable, cleans up after itself, and ships **no demo mode**
into the product.
