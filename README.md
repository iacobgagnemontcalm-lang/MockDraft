# DinoMock 🦕

A single-page fantasy football mock-draft PWA for the 2026 season. Supports
three league types — Dynasty (live Sleeper league with keepers), 2026 redraft
(8/10/12 teams, snake/linear), and CFL 2026 (6 teams, 13 rounds, NAT slot) —
with real-time multi-client draft sync over Firebase Realtime Database.

The 2026 redraft lineup is QB · RB×2 · WR×2 · TE · FLEX · K · DEF. Picking
**No K + 2 FLEX** in the lobby swaps the kicker slot for a second FLEX
(RB/WR/TE) and removes kickers from the draft pool entirely.

## Running

It's a static site — serve the repo root with any web server:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

(Opening `index.html` via `file://` won't work: the app fetches the bundled
CSVs and registers a service worker, both of which require http(s).)

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app (markup, styles, logic) |
| `sw.js` | Service worker — offline caching for app shell + CDN assets |
| `manifest.json` | PWA manifest |
| `rankings.csv` / `adp_rankings.csv` | NFL ECR + ADP data (FantasyPros export format) |
| `sleeper_rankings.csv` | Sleeper site ranks + Landmine scores ("Abusing Draft Rankings" sheet) |
| `cfl_rankings.csv` / `cfl_adp_rankings.csv` | CFL equivalents (maintained by hand) |
| `keepers.xlsx` | Dynasty keepers + pick ownership sheet |
| `scripts/update_rankings.py` | Refreshes the three NFL CSVs from their live sources |
| `backtest/` | Standalone draft-strategy simulation scripts (run with `node`) |

## Data sources

- **FantasyPros CSV** (bundled or imported via 📂 Rankings) — ECR, ADP, tiers, std-dev
- **"Abusing Draft Rankings" Google Sheet** — Sleeper's own draft ranks + Landmine scores
- **Sleeper API** — league/rosters/draft order (Dynasty), weekly projections
- **FantasyCalc API** — trade values for the draft report card

The three NFL CSVs refresh automatically every day at 10:00 UTC via the
`Update rankings` GitHub Actions workflow
(`.github/workflows/update-rankings.yml`), which runs
`scripts/update_rankings.py` and commits only when the data changed. It can
also be run on demand from the repo's Actions tab. A source that fails to
fetch keeps its previous CSV, and a source returning suspiciously few
players is rejected rather than committed.

## Draft logic

The "Top picks" panel ranks candidates with a composite *iackScore*:
marginal value-over-replacement weighted by roster need, ECR-vs-ADP steal
bonus, tier-cliff and depth-scarcity urgency, and a 3-pick look-ahead.
Open **How it works** in the app for the full methodology.
