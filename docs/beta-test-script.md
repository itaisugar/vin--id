# Vin.ID — Beta Test Script

A step-by-step run through the core Vin.ID loop. ~20–30 minutes. Do it on a
**phone** if you can; repeat key steps on desktop. When something is confusing
or broken, note it and send it via **Settings → Send beta feedback** (type
**Beta test result**).

Tip: keep an eye out for anything that needs **horizontal scrolling**, any
**untranslated text**, or anything that looks like a private/internal value.

## A. Account setup
1. Create an account (sign up with email + password) and sign in.
2. Switch language **English ⇄ עברית** (header or Settings) — confirm the layout
   flips to right-to-left in Hebrew and back.
3. On a phone, check the bottom navigation (Dashboard / Vehicles / Diagnose /
   Settings) and that nothing overflows.

## B. Vehicle setup
1. Add a vehicle (make, model, year; optionally VIN, license plate).
2. Set the **current mileage**.
3. Edit the vehicle and change a field; confirm it saves.

## C. Build vehicle history
1. Add a **maintenance** record (date, mileage, category, optional cost).
2. Add an **issue** (symptoms, severity, status).
3. Upload a **document** (PDF or image). Set a document type. Decide whether to
   **allow sharing** and whether it **contains personal info**.
4. Add a **reminder** (by date and/or mileage).
5. Open the vehicle page and confirm all four sections show your entries.

## D. AI mock flows (clearly marked as mock/demo)
1. Go to **Diagnose**, pick the vehicle, describe a symptom
   (e.g. "squeaking when braking"). Run it — note the "mock mode" notice.
2. **Save as issue** from the result; confirm it appears in the vehicle's issues.
3. On a document, tap **Extract with AI** (mock). Review the suggested fields.
4. **Confirm** the extracted metadata; confirm the document updates. (Or discard
   — nothing is saved automatically.)

## E. Vehicle Passport
1. From the vehicle, **Create Vehicle Passport**. Choose which scopes to include;
   review the preview.
2. Review the **Record Confidence Score** and read what it means.
3. On the success screen, **copy the share link** (and try the **Share** button
   on mobile). Read the "Next steps" card.
4. Open the share link in an **incognito / private window** (logged out) — this
   is the **public preview** a buyer sees. Check the content, the disclaimers,
   and that there's **no private data** (no file paths, no token).
5. Open the **Export PDF / print** page and use **Print → Save as PDF**. Confirm
   it's a clean report (no app menus, no dark background).
6. Create a **second** test Passport and **revoke** it; confirm its public link
   stops working.

## F. Transfer test (two users)
1. Use a **second account** (or a second browser / private window) as the buyer.
2. Open the seller's share link as the buyer and **Accept** the Passport.
3. Confirm a **copied vehicle** with its history appears in the buyer's account.
4. Back as the **seller**, confirm the original vehicle is now marked **Sold**
   (it's kept, not deleted), and that the buyer cannot see the seller's other
   data.

## G. Feedback
1. Go to **Settings → Send beta feedback**.
2. Submit at least one entry of type **Beta test result** summarizing how it
   went, plus any **Bug** / **Confusing** / **Trust / privacy concern** entries.
3. Use the questions in [beta-feedback-prompts.md](beta-feedback-prompts.md) as a
   guide.

## Optional: Data & privacy
- In **Settings → Data & privacy**, download the **JSON** and **CSV** exports and
  confirm they contain your data (and not files/private paths).
- Try **Request deletion** (it records a request — nothing is deleted
  automatically).

Done — thank you! See [known-limitations.md](known-limitations.md) for what's
intentionally not built yet.
