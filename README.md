# TalkBack

Vite + React + TypeScript party-game prototype backed by Supabase Auth, Postgres, and Storage.

The app now supports:

- email/password sign up and log in
- private user profiles synced from `auth.users`
- email-based friend requests
- accepted friendships
- private rounds that only the sender and recipient can read
- private audio storage with signed URLs

## Supabase Setup

1. Copy `.env.example` to `.env.local` and set:

   ```bash
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

2. In the Supabase dashboard, open `Authentication > Providers` and enable `Email`.

3. Decide whether new accounts must confirm their email:

   - If you want instant local testing, turn off email confirmation.
   - If you keep email confirmation on, make sure the app URL is in `Authentication > URL Configuration`.

4. Apply the migrations:

   ```bash
   supabase db push
   ```

   The core app schema starts with [`supabase/migrations/20260324202000_auth_friend_rounds.sql`](./supabase/migrations/20260324202000_auth_friend_rounds.sql) and the word-pack schema is added by [`supabase/migrations/20260328100000_word_packs.sql`](./supabase/migrations/20260328100000_word_packs.sql).

5. Start the app:

   ```bash
   npm run dev
   ```

## Offline Pack Generation

Use the offline generator to create themed packs from a local word list and push them into Supabase with a service-role key.

1. Add these values to your shell or `.env.local`:

   ```bash
   SUPABASE_URL=your-project-url
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```

2. Provide words as JSON or newline-separated input, then run:

   ```bash
   npm run generate:pack -- --name "Animals" --words-file ./packs/animals.txt
   ```

   The script also accepts `--words-json '["one","two"]'` or piped stdin.

3. The generator normalizes phrases to lowercase, trims whitespace, computes difficulty, and inserts rows into `word_packs` and `words`.

## Auth Notes

- Supabase does support OAuth providers like Google, GitHub, Apple, and others.
- This app is wired for email/password accounts because friend requests target exact email addresses.
- You can still enable OAuth later, but you should make sure the provider returns a verified email address if you want the friend-request flow to stay email-based.

## What The Migration Creates

- `profiles`: one row per `auth.users` account
- `friend_requests`: pending or resolved friendship invitations
- `friendships`: accepted friend pairs
- `rounds`: sender/recipient-scoped rounds
- `word_packs`: themed prompt packs
- `words`: normalized phrases with computed difficulty metadata
- private `audio` bucket access policies
- RPCs:
  - `request_friendship(recipient_email_input text)`
  - `respond_to_friend_request(friend_request_id uuid, accept_request boolean)`

## Behavior

- Users only see rounds where they are the sender or recipient.
- Only confirmed friends can receive new rounds.
- Only the recipient can upload an attempt and submit a guess.
- Audio files are stored in private storage and loaded with signed URLs.
- Round creation now presents three generated phrase choices from the selected pack: easy, medium, and hard.

## Local Validation

Production build passes:

```bash
npm run build
```

The build now runs `scripts/update-sw-version.js` first to stamp `public/sw.js` with a cache version. It resolves in this order: `SW_VERSION` env var, `git-<12-char hash>` from `git rev-parse --short=12 HEAD`, then a `build-<timestamp>` fallback.

## PWA And GitHub Pages

- The app ships with a web manifest, service worker registration, and install prompt support for Android browsers that fire `beforeinstallprompt`.
- iPhone and iPad install is supported through Safari `Share > Add to Home Screen`.
- `npm run dev` already binds to `0.0.0.0:5173`, so the app is reachable from other devices on the same LAN.
- Push subscription setup runs once per signed-in user session, stores the subscription in Supabase, and sends a single clip notification through an Edge Function after a round is created.
- Set `VITE_PUSH_VAPID_PUBLIC_KEY` in `.env.local` to the public VAPID key generated for the push backend.
- For GitHub Pages builds, also add `VITE_PUSH_VAPID_PUBLIC_KEY` as a repository Actions variable in `Settings > Secrets and variables > Actions > Variables`, then redeploy. This is a public key, so it belongs in Variables, not Secrets.
- For GitHub Pages, set `BASE_PATH` or `VITE_BASE_PATH` to your repository path such as `/TalkBack/` when you need a manual override. The Vite config also auto-detects the repository name during GitHub Actions builds.
- Optionally set `SW_VERSION` in CI if you want to override the service-worker cache version; otherwise it defaults to the short git commit hash.
- The manifest uses relative URLs so the install entry point works both at `/` and at a GitHub Pages repository subpath.

## HTTPS For Cross-Device Recording

To test microphone recording or home-screen install from another device on the same LAN, serve Vite over HTTPS with a certificate trusted by that device.

1. Create a local certificate and key whose SAN includes the hostname or IP address you will open from the other device.
2. Add these lines to `.env.local`:

   ```bash
   DEV_HTTPS=true
   DEV_SSL_KEY_FILE=certs/dev-key.pem
   DEV_SSL_CERT_FILE=certs/dev-cert.pem
   ```

3. Run:

   ```bash
   npm run dev
   ```

4. Open `https://YOUR_HOSTNAME_OR_IP:5173` on the other device, and make sure that device trusts the certificate chain.

## Push Notifications

- Create the subscription table with `supabase db push` after applying [`supabase/migrations/20260328000000_push_subscriptions.sql`](./supabase/migrations/20260328000000_push_subscriptions.sql).
- Generate VAPID keys locally with `npx web-push generate-vapid-keys`.
- To enable push debug logs in a production build, open the app once with `?push-debug=1` in the URL, or run `localStorage.setItem('push-debug', '1')` in the browser console and reload.
- Copy [`supabase/functions/.env.example`](./supabase/functions/.env.example) to `supabase/functions/.env`, fill in the values, then load them into Supabase:

  ```bash
  supabase secrets set \
    --env-file supabase/functions/.env
  ```

- The function expects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
- Deploy the function with `supabase functions deploy send-push-notification --no-verify-jwt`.
- The repo includes [`supabase/config.toml`](./supabase/config.toml) with `verify_jwt = false` for this function because the app uses a modern `sb_publishable_...` client key. If the function was already deployed earlier, confirm in the Supabase dashboard that `send-push-notification` has `Verify JWT with legacy secret` turned off, then redeploy if needed.
- The push payload is fixed to `Your friend sent you a clip 🎤`.
