Original prompt: Replace Single Player with a Monthly Campaign system in this React + Vite + TypeScript + Supabase app, including DB-driven campaigns, reverse-only mode, progression, leaderboard, Easter campaign seeding, and campaign-tied pack unlocking.

- Updated the campaign UI to a two-screen flow: a focused road page with a bottom Start CTA and a separate challenge-play screen.
- Restyled the road to a mobile-game presentation with a centered egg path, numbered egg nodes, a side leaderboard action, and drifting background eggs.
- Normalized campaign-facing copy so the visible title reads "Easter Campaign" instead of the longer seeded title.
- Updated the home campaign entry to use the shorter title and a cropped banner-art treatment.
- Adjusted the Easter seed script so regenerated assets and title metadata match the cleaner customer-facing copy.

TODO
- If the user wants pixel-perfect matching, run a browser screenshot pass against `/campaign` after starting the dev server and tune spacing/colors against the provided reference.
- Once Supabase CLI auth is available again, apply any pending migrations and rerun the Easter seed script so the DB assets match the updated banner wording exactly.
