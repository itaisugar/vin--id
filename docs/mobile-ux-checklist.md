# Vin.ID — Mobile UX Checklist (pre-beta)

Manual responsive / RTL pass. Run in browser devtools (and on a real phone if
possible) before beta. The golden rule throughout: **no horizontal scrolling**.

## Viewports to test

- **iPhone-sized**: 390×844 (and the smaller 360–375 width).
- **Android-sized**: 360×800 / 412×915.
- Optionally a notched device profile (e.g. iPhone 14) to verify the bottom-nav
  **safe-area** padding (the home indicator must not overlap nav labels).

For each: test in **English (LTR)** and **Hebrew (RTL)** — toggle language from
the header or Settings.

## Global

- [ ] No horizontal scrolling on any page (rotate through every screen below).
- [ ] Bottom navigation (Dashboard / Vehicles / Diagnose / Settings): 4 items
      fit without overflow, icons + labels aligned, active route highlighted.
- [ ] Bottom nav never covers a form's submit button (content has bottom padding;
      scroll to confirm submit/cancel are reachable above the nav).
- [ ] Tap targets feel ≥ ~40px; buttons/links are easy to hit.
- [ ] Focus-visible ring shows when tabbing through inputs/buttons.

## Dashboard

- [ ] Cards stack cleanly; onboarding card (empty state) is readable.
- [ ] Quick-action buttons wrap and are easy to tap.
- [ ] Vehicle cards: long names truncate, status badge stays put.
- [ ] Reminders list isn't cramped.

## Vehicles

- [ ] List: cards stack; long make/model truncates.
- [ ] Detail: long vehicle name wraps; status badge doesn't overflow.
- [ ] **VIN** and **license plate** wrap (no overflow / no page scroll).
- [ ] Header actions (Diagnose / Edit / Archive) wrap and are tappable; the
      destructive Archive sits apart from the primary actions.

## Forms (vehicle / maintenance / issue / document / reminder / diagnosis / feedback)

- [ ] Inputs are full width; labels readable; selects and date inputs usable.
- [ ] Validation messages appear under the field and are visible.
- [ ] Long helper text wraps.
- [ ] Submit + cancel reachable (not hidden behind the bottom nav).
- [ ] Number fields show a numeric keyboard (year / mileage).

## Passport

- [ ] Create page: scope checkboxes + preview readable; buttons stack on mobile.
- [ ] Post-creation share state: the **share URL** sits in a field that doesn't
      overflow; Copy / Share / Open preview / Export PDF / Open passport stack
      full-width on mobile. The "Next steps" card is readable.
- [ ] Owner detail: status, Record Confidence card, and the **snapshot hash**
      wrap safely (hash is in a mono block that breaks).
- [ ] Public preview (`/p/[token]`): vehicle summary, confidence, timeline,
      document metadata cards aren't cramped; **hash wraps**; disclaimers visible
      but not overwhelming.
- [ ] Accept CTA is clear and tappable (sign-in / accept / owner message);
      buttons full-width on mobile.
- [ ] **No `storage_path`, file URLs, bucket name, or raw token** anywhere.

## Print / PDF route

- [ ] On-screen: back link + "Print / Save as PDF" button visible.
- [ ] Print preview (Cmd/Ctrl+P): clean white report — no dark app background,
      no app header / sidebar / bottom nav, no Print button.
- [ ] Long hash / IDs wrap; report is single-column and readable.

## Settings / Data & privacy

- [ ] Cards stack; language switcher and logout reachable.
- [ ] Export download buttons (JSON / maintenance CSV / issues CSV) stack
      full-width on mobile; labels don't overflow.
- [ ] Export warning + helper text wrap and are visible.
- [ ] "Request deletion" confirm dialog is readable and tappable.

## Hebrew RTL (spot-check each area on mobile)

- [ ] Dashboard, Vehicles, Maintenance, Issues, Documents, Reminders, Passport,
      Public preview, Diagnosis, Settings, Privacy/Terms.
- [ ] Text aligns to the right; layout direction flips correctly.
- [ ] Icon/label spacing reads naturally; button order isn't confusing.
- [ ] No overflowing Hebrew labels; **no untranslated keys** (you should never
      see raw keys like `passports.share.title`).
- [ ] Hashes / URLs / VIN still wrap in RTL.

## Long-content stress check

Enter/inspect long values and confirm they wrap (no page scroll):

- [ ] VIN, license plate, file names, document vendor names.
- [ ] Snapshot hash, Passport share URL.
- [ ] Issue symptoms, diagnosis text.
- [ ] Export download labels.

## Notes

- This is a manual checklist; there is no automated mobile test suite (TODO if
  the surface grows).
