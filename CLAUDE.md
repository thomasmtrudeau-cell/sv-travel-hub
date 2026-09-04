# CLAUDE.md — sv-travel-hub

This file was missing prior to 2026-08-10 (doc-gap sweep, part of the SV OS
governance audit). What this repo does is not restated here to avoid
inventing facts — read README.md first, and `sv-way.config.json` for this
repo's declared role. In short: an SPA mapping client schedules, venues, and
travel proximity; `src/data/` is its own write-home for hand-maintained
venue/schedule datasets.

## Stadium Guide × Travel Hub — layered, not converged (D2, BE 2026-09-02)

pq-055 asked whether sv-registry's Stadium Guide (`data/reference/st-complexes`,
the venues/addresses reference) and this Travel Hub converge or stay separate.
**Ruled: explicitly layered.** The Guide is the address/venue reference; this
hub is the map-and-proximity surface over schedules. No code change followed
the ruling; it is captured here (per the SV Way capture loop) so a future
session does not re-open it. The read-duty gap below is unaffected by it.

## Known gap — read duty (marked, not scheduled)

This repo's own `sv-way.config.json` already flags that it names client
players (schedule CSVs, roster comparisons) with no code resolving them
against Stadium-Ventures/sv-registry canon — a self-admitted gap against The
SV Way's "read duty" rule. **Direction as of 2026-08-10 (BE):** this one is
marked for a post Tom/Kent discussion to re-optimize, rather than an
immediate fix — don't build a registry-resolution path here without that
conversation happening first.

## 🧭 The SV Way — North Star doctrine (read this first, every session)

THE-SV-WAY.md in Stadium-Ventures/sv-registry (served live at
https://sv-internal-hub.vercel.app/sv-way.md) is the North Star every Stadium
Ventures tool and every chat working on one routes through — read it at
session start, before anything else. Non-negotiables even before you read it:
every player fact resolves to the player's file in sv-registry and every
surface is a projection of it; nothing unvalidated projects (flag it, file a
candidate, never overwrite a stable field); one write door (write-registry
chokepoint / governed writers); one write-home per dataset; firm work is
first-class but becomes a player fact only when it actualizes through that one
door; systems doing work about a player resolve them against canon first (read
duty); automation is silent when healthy and posts actionable-only to
#sv-automation; collaborative tools live in Stadium-Ventures org repos; locked
client-facing artifacts (Report Packets) are never moved or regenerated. This
tool's hub registration + #sv-automation hookup are canonical requirements of
being "promoted." When your work decides something reusable, capture it
(status slice → SOP → canon) before you finish.

## SV Internal Hub registry

No `sv-app.json` was found in this repo as of 2026-08-10 — if this app is
meant to be registered at https://sv-internal-hub.vercel.app, add one (schema:
https://sv-internal-hub.vercel.app/register.md) in the same commit as any
change to its scheduled jobs, data sources/destinations, hosting, monitoring,
known issues, or ownership. Don't invent facts — leave a field out rather than
guess, and note open questions in `notes`.
