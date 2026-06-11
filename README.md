# DinoMock 🦕

A single-page fantasy football mock-draft PWA for the 2026 season. Supports
three league types — Dynasty (live Sleeper league with keepers), 2026 redraft
(10 teams, snake/linear), and CFL 2026 (6 teams, 13 rounds, NAT slot) — with
real-time multi-client draft sync over Firebase Realtime Database.

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
| `cfl_rankings.csv` / `cfl_adp_rankings.csv` | CFL equivalents |
| `keepers.xlsx` | Dynasty keepers + pick ownership sheet |
| `backtest/` | Standalone draft-strategy simulation scripts (run with `node`) |

## Data sources

- **FantasyPros CSV** (bundled or imported via 📂 Rankings) — ECR, ADP, tiers, std-dev
- **Sleeper API** — league/rosters/draft order (Dynasty), weekly projections
- **FantasyCalc API** — trade values for the draft report card

## Draft logic

The "Top picks" panel ranks candidates with a composite *iackScore*:
marginal value-over-replacement weighted by roster need, ECR-vs-ADP steal
bonus, tier-cliff and depth-scarcity urgency, and a 3-pick look-ahead.
Open **How it works** in the app for the full methodology.
