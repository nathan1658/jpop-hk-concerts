# J-Pop HK Concerts

Interactive Next.js board for tracking Japanese artists, VTubers, and virtual
artists playing live concerts in Hong Kong.

## Stack

- Next.js App Router with static export
- Tailwind CSS v4
- Firebase Hosting
- Firestore read path for live concert data
- Local seed data fallback in `src/data/concerts.ts`

## Data Model

The UI reads from Firestore collection `concerts` first. If Firestore is empty,
unconfigured, or blocked, it falls back to seed data so the deployed site still works.

Each document should match `ConcertEvent` in `src/types/concert.ts`:

```ts
{
  artist: "LiSA",
  tour: "LiSA LiVE is Smile Always - 15 in Hong Kong",
  dates: ["2026-07-18"],
  venue: "AsiaWorld-Arena, AsiaWorld-Expo",
  district: "Chek Lap Kok",
  city: "Hong Kong",
  genres: ["Anisong", "Rock"],
  status: "on-sale",
  generalSaleStart: "2026-04-22T15:00:00+08:00",
  presaleStart: "2026-04-20T15:00:00+08:00",
  ticketingAgent: "Cityline",
  price: "Standing HK$1,099; seated HK$1,099 / $899 / $699",
  sourceUrl: "https://...",
  sourceName: "Live Nation HK",
  sourceConfidence: "promoter",
  dataQuality: "verified",
  lastVerified: "2026-05-30"
}
```

Ticket status is derived in the UI: past events become `past`, future
`generalSaleStart` values become `soon`, and sale windows that have opened
become `on-sale`. Do not hand-label every new event as `on-sale`.

## Scope

Include Japanese solo artists, Japanese bands/groups, Japan-born artists,
VTubers, and virtual artists when the Hong Kong event is a music concert or
live show.

## Source Policy

Use sources in this order:

1. Canonical venue or promoter pages: AsiaWorld-Expo, Kai Tak Sports Park, Live Nation HK.
2. Ticketing confirmation: Cityline, KKTIX, AsiaWorld-Expo KKTIX, Neon Lit, Klook, Ticketflap, TIDES, HK Ticketing.
3. Discovery only: Timable or other event roundups. These can suggest leads, but should not publish a final event row unless confirmed by tier 1 or tier 2.

`npm run check:sources` treats canonical source failures as hard failures.
Some ticketing sites, currently KKTIX and Klook, return 403 to a plain fetch;
keep them in the registry, but use a dedicated adapter or manual confirmation
before treating them as automated ingestion sources.

The source registry is in `src/data/sources.ts`.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run check:sources
npm run sync:sources:dry
npm run sync:sources
npm run deploy
```

## Firebase

Firebase project created:

```text
jpop-hk-concerts
```

The deployed frontend is configured through `.env.local` for local builds and
`.env.example` for reference. The public Firebase web config is safe to expose;
Firestore writes stay denied in `firestore.rules`.

## Automatic Updates

Current production behavior is intentionally split into two parts:

1. The frontend reads `concerts` from Firestore in realtime.
2. If Firestore data changes, the live site updates without redeploying.
3. Source registry lives in `src/data/sources.ts`.
4. `npm run check:sources` verifies source availability.
5. `scripts/sync-sources.mjs` fetches every curated source URL, parses verified
   fields, and writes the merged result to Firestore.
6. `.github/workflows/sync-sources.yml` runs the sync daily at 06:00 HKT and can
   also be started manually from GitHub Actions.

The sync job is intentionally conservative. It updates events already present in
`src/data/concerts.ts`; it does not publish random discovery-page matches as new
concerts yet. New sources should first be added to the curated dataset, then the
job keeps them fresh.

GitHub Actions needs one repository secret:

```text
FIREBASE_SERVICE_ACCOUNT
```

Set it to a Firebase service account JSON value with Firestore write permission.
Local runs can use either that env var, `FIRESTORE_ACCESS_TOKEN`, or the current
`gcloud auth print-access-token` session.

The public GitHub repo is configured with a dedicated `github-sync` service
account secret for the scheduled Firestore sync.

Do not enable anonymous public writes just to collect alerts or user submissions.
Add auth and a server-side ingestion job before accepting user-generated data.

## Ticket Alerts

Sale alerts use the browser Notification API and localStorage. They work for
events with a future `generalSaleStart` while the page is open and notification
permission is granted. True background push across devices should use Firebase
Cloud Messaging plus a server-side scheduler.

The seed dataset is source-backed, not scraped live. As of 2026-05-31 HKT, all
verified public sale windows currently in the seed data have already opened, so
the countdown UI will show "Sale opened" until a future sale date is added.
