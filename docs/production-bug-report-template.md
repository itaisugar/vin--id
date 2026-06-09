# Vin.ID — Production Bug Report

Copy this template per bug. Keep it short and factual.

---

## Summary
<!-- One sentence: what's broken. -->

## Environment
- [ ] Production (Vercel)
- [ ] Preview deployment
- [ ] Local dev
- App version / commit: `<git sha or Vercel deployment id>`
- Device / browser / OS: `<e.g. iPhone 15, Safari; or Chrome 120 / macOS>`
- Viewport: [ ] mobile  [ ] desktop
- Language: [ ] English  [ ] Hebrew (RTL)

## URL
`<exact URL where it happened, e.g. https://<domain>/vehicles/<id>>`
<!-- For a Passport share link, paste the /p/<token> URL (token is a one-time
     share secret — only include if needed and rotate/revoke afterwards). -->

## Account / user type
- [ ] Seller / owner
- [ ] Buyer (second account)
- [ ] Logged out
- Account email (optional): `<...>`

## Steps to reproduce
1.
2.
3.

## Expected result
<!-- What should have happened. -->

## Actual result
<!-- What actually happened. Include exact error text/copy. -->

## Screenshots / logs
<!-- Attach screenshots. For server errors, include the Vercel function log
     (Vercel → Deployment → Functions/Logs) and any browser console error.
     DO NOT paste secrets (anon key is public; never paste a service-role key,
     token_hash, or storage paths). -->

## Severity
- [ ] S1 — production down / data loss / security leak
- [ ] S2 — major flow broken (auth, passport accept, upload)
- [ ] S3 — minor flow broken / wrong copy
- [ ] S4 — cosmetic (layout, spacing, RTL polish)

## Suspected area
- [ ] Auth / redirects
- [ ] Env / config (APP_PUBLIC_URL, Supabase URL/keys)
- [ ] Storage / signed URLs
- [ ] RLS / multi-user isolation
- [ ] Passport create / share / public preview / accept / revoke
- [ ] Mock diagnosis / document extraction
- [ ] Vehicle / maintenance / issues / reminders
- [ ] Navigation / links
- [ ] Mobile / RTL layout
- [ ] Copy / safety / legal wording
- [ ] Other: `<...>`

## Security checklist (if the bug could leak data)
- [ ] No service-role key exposed in the browser
- [ ] No `token_hash` exposed
- [ ] No `storage_path` / raw file URL exposed in public preview
- [ ] Storage bucket still private; RLS still enabled
