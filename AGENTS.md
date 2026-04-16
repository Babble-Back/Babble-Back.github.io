# AGENTS.md

## Project

BackTalk is a Vite + React + TypeScript app for private voice-game rounds between friends. Supabase handles auth, Postgres data, row-level security, and private audio storage.

## Commands

- `npm run dev` starts the Vite dev server on `0.0.0.0:5173`.
- `npm run build` runs the TypeScript build and Vite production build. This is the main validation command in this repo.
- `npm run preview` serves the production build locally.
- `supabase db push` applies local SQL migrations when working against a Supabase project.

## Environment

Required in `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Optional for HTTPS device testing:

- `DEV_HTTPS=true`
- `DEV_SSL_KEY_FILE=...`
- `DEV_SSL_CERT_FILE=...`

Do not commit secrets from `.env.local`. If env requirements change, update `.env.example`.

## Code Layout

- `src/App.tsx`: top-level app shell, auth session bootstrap, data refresh, and view switching.
- `src/features/auth`: sign-up and sign-in UI.
- `src/features/social`: friend request and friend list UI/types.
- `src/features/rounds`: round creation, inbox/home views, playback flow, prompts, and scoring helpers.
- `src/audio`: recording hooks and client-side audio utilities like WAV encoding and reversing.
- `src/lib`: Supabase client setup plus auth, friendship, round, and storage access helpers.
- `supabase/migrations`: schema, RLS policies, triggers, RPCs, and storage policies.
- `dist/` and `*.tsbuildinfo`: generated output; do not hand-edit them.

## Domain Rules

- Profiles are synced from `auth.users` into `public.profiles`.
- Emails are normalized to lowercase and trimmed before persistence or lookup.
- Rounds and friendships are private by default through RLS.
- Only confirmed friends can create rounds with each other.
- Only the recipient can upload an attempt and submit a guess on a round.
- Audio files live in the private `audio` bucket and are loaded through signed URLs.
- Round statuses are `waiting_for_attempt`, `attempted`, and `complete`.

## Change Guidance

- Keep Supabase access concentrated in `src/lib/*`; avoid sprinkling raw queries through UI components.
- When schema or storage rules change, update TypeScript mappings and calling code alongside the SQL migration.
- Prefer adding a new migration instead of rewriting an existing applied migration.
- Preserve the current mobile-first recording flow and secure-context assumptions for microphone access.
- Keep private-audio behavior intact; changes to bucket paths, signed URL generation, or storage policies are high risk.
- If you change env requirements, docs, or setup steps, update `README.md` and `.env.example` in the same pass.
- Service-worker cache busting is deploy/version based (not per-file manifest hashing): `scripts/update-sw-version.js` stamps `BUILD_VERSION` in `public/sw.js` using `SW_VERSION` override, then short git hash, then a timestamp fallback.
- `public/sw.js` versioned cache buckets should remain aligned with `BUILD_VERSION` (for example `precache-core-*`, `precache-card-*`, `runtime-*`) so activate can clean up older versions safely.

## Validation

- Run `npm run build` before handing work off when code changes are made.
- There is no dedicated test or lint script in the current repo, so build success is the baseline automated check.
