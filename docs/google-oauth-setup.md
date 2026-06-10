# Vin.ID — Google OAuth Setup (Supabase Auth)

"Continue with Google" uses **Supabase Auth** OAuth. The app code is ready; you
must configure Google + Supabase once. **No Google secret goes in app code or
`NEXT_PUBLIC_*` env** — it lives only in Supabase provider settings.

## How it works (code)

- The login & signup pages show a **Continue with Google** button
  ([components/auth/google-button.tsx](../components/auth/google-button.tsx)).
- It calls `supabase.auth.signInWithOAuth({ provider: 'google', options: {
  redirectTo: <origin>/auth/callback?next=... } })` (browser → Google → back).
- [app/auth/callback/route.ts](../app/auth/callback/route.ts) exchanges the code
  for a session and redirects to `next` (default `/dashboard`).
- The **profile row** is created by the existing `handle_new_user` DB trigger on
  `auth.users` insert (keyed on the auth user id), so there's no app-side upsert
  and **no duplicate profile**.
- Email/password auth is unchanged.

## 1. Google Cloud — OAuth Client ID

1. Google Cloud Console → **APIs & Services → Credentials**.
2. **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. **Authorized redirect URI** — add your Supabase Auth callback:
   ```
   https://YOUR_SUPABASE_PROJECT.supabase.co/auth/v1/callback
   ```
   (Find the exact URL in Supabase → Authentication → Providers → Google.)
5. Create, then copy the **Client ID** and **Client Secret**.
   (You may also need to configure the OAuth consent screen — External, with your
   app name and a support email.)

## 2. Supabase — enable Google

1. Supabase Dashboard → **Authentication → Providers → Google**.
2. **Enable** Google.
3. Paste the **Client ID** and **Client Secret** from step 1.
4. **Save**.

## 3. Supabase — URL configuration

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL** = your production URL, e.g. `https://YOUR-APP.vercel.app`.
- **Redirect URLs** — add (so `/auth/callback` is allowed in each env):
  ```
  http://localhost:3000/**
  http://localhost:3001/**
  http://localhost:3002/**
  https://YOUR-APP.vercel.app/**
  ```

## Important

- **Do NOT** put the Google **Client Secret** in app code or in any
  `NEXT_PUBLIC_*` env var. It belongs only in Supabase provider settings.
- The browser only ever uses the public **anon key**.
- **Existing email/password users keep their data.** We never merge `auth.users`
  and never move ownership data between users.

## Same-email behavior (account linking)

If someone signed up with **email/password** and later uses **Google with the
same email**, behavior depends on Supabase's identity-linking configuration:

- Where Supabase auto-links identities (matching, confirmed email), the user
  lands in their existing account — same `auth.users` id, same profile, **no
  data loss**.
- If Supabase returns an identity/account conflict instead, the callback can't
  establish a session and redirects to `/login?error=oauth`, which shows a safe
  message: *"An account with this email may already exist. Please sign in with
  your original method, then connect Google later if supported."*

We deliberately do **not** auto-merge accounts.
`TODO(account-linking)`: add an explicit, user-initiated "connect Google"
screen for already-signed-in users if testers need it.

## Testing

- **Local**: `npm run dev`, open `/login`, click **Continue with Google**,
  complete Google, land on `/dashboard`. (Requires `localhost:3000/**` in
  Supabase Redirect URLs.)
- **Vercel**: same on the production URL (requires the Vercel URL in Redirect
  URLs and as Site URL).
- **Email/password** still works unchanged.
- **Same-email**: sign up with email/password, then try Google with that email —
  confirm you either land in the same account (no data loss) or see the safe
  conflict message; **no duplicate profile** row appears in `profiles`.
