# Admin workspace guides — how this set is maintained

VA-facing guides to the admin workspace, published at **docs.novaracleaning.com**.

These are the *"How the Tool Works"* category. They are deliberately separate from the
policy and pricing knowledge base: policy documents are authoritative on **what we promise a
customer**, these are authoritative on **what the software currently does**. Both are
maintained independently and both are fed to the Ops Assistant as distinct categories.

> This README is developer-facing and is not published — the site skips files beginning with
> `_` and this one is excluded by name.

## What's here

```
docs/admin-workspace/
  <slug>.md                              one guide per workspace section
  screenshots/                           annotated PNGs + manifest.json
  _data/pricing-snapshot.json            live pricing config, read from Supabase
  _data/pricing-examples.generated.json  worked examples, computed by the real engine
  _data/ops-assistant-knowledge.generated.json  what the Ops Assistant is fed
```

Anything ending `.generated.json` is produced by a script. Don't hand-edit it.

## The rules these guides are written under

1. **The live code is the source of truth for current behaviour.** Not a spec, not a plan,
   not a prior conversation. If a guide describes a screen, someone read the code for that
   screen.
2. **Nothing is invented.** Where behaviour could not be established by inspection, it is
   marked `:::unverified` for a human to confirm rather than guessed at.
3. **Pricing figures are generated, never typed.** See below.
4. **Disagreements are recorded, not resolved.** Where an older document, a screen label or a
   legacy code path contradicts the live behaviour, the guide carries a `:::drift` note. Those
   are collected automatically at `/docs/discrepancies`.
5. **Every "how to use it" step has a real, annotated screenshot** of the actual workspace,
   captured from this repo's own code.

## Re-verifying (do this as one pass)

A guide is only trustworthy to the extent its "last verified" date is honest. When
re-verifying, do all four steps — a guide with fresh prose and stale screenshots is worse
than one that's uniformly old, because it looks current.

```bash
# 1. Refresh the live pricing snapshot (see below), then recompute the examples
npm run docs:pricing

# 2. Recapture the screenshots against the current UI
npm run dev -- --port 3100          # in one terminal
npm run docs:capture                # in another

# 3. Re-read the code for anything that changed, update the prose, and bump
#    `lastVerified` in the front matter of every guide you checked

# 4. Check the set holds together, then refresh what the assistant knows
npm run docs:verify
npm run docs:export
```

`docs:verify` fails on a guide referencing a screenshot that doesn't exist, missing front
matter, a bad date format, or a screenshot filed against a guide that's gone. It warns when a
screenshot is older than the guide that uses it, or when a callout couldn't be located during
capture — that last one usually means the screen moved and the step needs rewriting.

### Refreshing the pricing snapshot

`_data/pricing-snapshot.json` is a verbatim read of the live pricing configuration. Refresh it
by re-running this against the production project and replacing the file's contents:

```sql
select jsonb_build_object(
  'captured_at', now(),
  'project_ref', 'sxdraeptzuamsgjcvfeg',
  'config_version', (select version from dynamic_pricing_config_versions where is_active),
  'config',         (select config  from dynamic_pricing_config_versions where is_active),
  'zones', (select jsonb_agg(to_jsonb(z) - 'created_at' - 'updated_at' order by z.code)
            from pricing_zones z),
  'cleaner_pay_rates', (select jsonb_agg(jsonb_build_object(
      'min_crew_size', min_crew_size, 'max_crew_size', max_crew_size,
      'pay_tier', pay_tier, 'rate_percent', rate_percent) order by pay_tier, min_crew_size)
    from cleaner_pay_rates),
  'focused_same_day_settings', (select value from app_settings
                                where key = 'focused_same_day_settings'),
  'zip_zone_counts', (select jsonb_agg(t) from (
      select z.code, count(pz.zip) as mapped_zips from pricing_zones z
      left join pricing_zone_zips pz on pz.zone_id = z.id group by z.code order by z.code) t)
);
```

`npm run docs:pricing` then runs that snapshot through `src/lib/dynamic-pricing.ts` — the same
module that prices a real quote — and writes the worked examples the guides quote. This is why
a pricing figure in a guide can only be wrong if the engine is wrong.

It reproduces two things the server does at load time, and both matter:

- Focused rates, the focused minimum, the bundle discount and the same-day fee are **overlaid
  from `app_settings.focused_same_day_settings`**, which wins over the copy in the config row.
- The price floor uses the **Foundation percentages from the live `cleaner_pay_rates` table**,
  not the engine's 35/40 fallback.

## Screenshots

`npm run docs:capture` renders the real admin components in a headless browser and annotates
each shot with numbered callouts positioned from the live DOM.

**No production data is involved.** Every Supabase call is intercepted and answered from
`scripts/docs/capture/demo-data.ts`, an invented dataset using `@example.test` addresses and
the reserved 555-01xx phone block. The production database is never contacted, so a real
customer, contractor or payment record cannot reach an image. The one exception is the pricing
quote, which runs the actual pricing engine over the snapshot so the pricing screenshot shows
the same numbers as the guide.

Images live here rather than in `public/` on purpose: anything under `public/` is served
statically on every host and bypasses the middleware, which would leave the screenshots
fetchable by anyone who guessed a filename. They are served instead by
`src/app/docs/asset/[file]/route.ts`, which re-runs the admin check per request.

Capture a subset while iterating:

```bash
npm run docs:capture -- bookings pricing      # by guide
npm run docs:capture -- internal-booking-quote-rail   # by shot id
npx tsx scripts/docs/capture/probe.ts /admin/csr "Live quote"   # find a stable selector
```

Preview a guide's rendering without signing in:

```bash
npm run docs:preview -- pricing
```

## Access

`/docs/*` is served on **docs.novaracleaning.com** and gated by the same admin/VA check the
workspace uses — a signed-in `@novaracleaning.com` account holding `admin` or `va`.

**Sign in on the docs host itself.** The admin workspace session lives on
`admin.novaracleaning.com` (and in the browser's localStorage). This site reads a
**cookie** on `docs.novaracleaning.com`. Those are two different origins and two
different stores, so signing in on the admin workspace and coming back here cannot
work. Google OAuth returns to `/docs/auth/callback` so the cookie is set on this
host. Email/password sign-in on the same page does the same.

The gate is enforced **server-side in every page**, not only in the layout. A Next.js layout
is not a security boundary: it and its pages render in parallel, so a layout that returns
early still emits the page's HTML into the response. Gating only there leaked the guide text
to signed-out requests. If you add a page under `/docs`, gate it in the page.

Supabase Auth must list `https://docs.novaracleaning.com/docs/auth/callback` (and
`http://localhost:3000/docs/auth/callback` for local) as a redirect URL, or Google
sign-in on this host will be rejected. Email/password still works without that.

Defence in depth on top of the gate: the middleware serves a `Disallow: /` robots.txt for this
host and sets `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex` on every response,
and the pages carry `robots: { index: false }` metadata.

## Known limitation of this pass

The brief asked for these guides to be cross-referenced against the specs and policy documents
in Google Drive. **That could not be done.** The Google Drive integration available to the
agent that wrote them required an authentication step that was not completed, so no Drive
document was read.

What this means in practice:

- The guides are grounded in the live code and the live Supabase configuration, which is the
  part the brief treated as authoritative. That part is solid.
- The discrepancies recorded at `/docs/discrepancies` are **code-versus-code and
  code-versus-configuration only** — for example, a screen label that disagrees with the live
  rate table. They are real, but they are not the full picture.
- **Drift between these guides and the Drive policy documents has not been assessed.** Someone
  with Drive access should read the guides against the policy and pricing documents and add
  `:::drift` notes for anything that disagrees. Until that happens, the discrepancy list should
  be read as incomplete rather than as a clean bill of health.
