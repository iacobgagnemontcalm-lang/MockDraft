import json, requests
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}

print("=" * 20, "SLEEPER GRAPHQL")
for adp_type in ["redraft_ppr", "redraft_half_ppr", "ppr", "redraft_standard"]:
    q = ('query adp { adp_data(sport: "nfl", season: "2026", adp_type: "%s") '
         '{ player_id adp } }' % adp_type)
    try:
        r = requests.post("https://sleeper.com/graphql", headers={**UA, "Content-Type": "application/json"},
                          json={"query": q}, timeout=45)
        print(f"[{adp_type}] HTTP {r.status_code}: {r.text[:400]}")
    except Exception as e:
        print(f"[{adp_type}] EXC {e}")

print("=" * 20, "YAHOO PAGINATION")
base = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players"
seen = set()
for start in range(0, 400, 25):
    path = (f"{base};position=ALL;start={start};count=25;sort=rank_season;"
            f"search=;out=draft_analysis;ranks=season/draft_analysis")
    r = requests.get(path, params={"format": "json_f"}, headers={**UA, "Accept": "application/json"}, timeout=45)
    if r.status_code != 200:
        print(f"start={start}: HTTP {r.status_code} {r.text[:200]}"); break
    txt = r.text
    n_names = txt.count('"full"')
    n_adp = txt.count('"average_pick"')
    before = len(seen)
    import re as _re
    for m in _re.finditer(r'"full"\s*:\s*"([^"]+)"', txt):
        seen.add(m.group(1))
    print(f"start={start}: names={n_names} average_pick={n_adp} new={len(seen)-before} total={len(seen)}")
    if start == 0:
        print("  sample:", txt[:600])

print("=" * 20, "ESPN")
r = requests.get("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3",
    params={"view": "kona_player_info"},
    headers={**UA, "Accept": "application/json", "x-fantasy-filter": json.dumps(
        {"players": {"limit": 400, "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "PPR"}}})},
    timeout=90)
pl = r.json().get("players") or []
have_adp = [p for p in pl if ((p.get("player") or {}).get("ownership") or {}).get("averageDraftPosition", 0) > 0]
print(f"HTTP {r.status_code} players={len(pl)} with real ADP={len(have_adp)}")
for p in pl[:3]:
    o = (p.get("player") or {})
    print("  ", o.get("fullName"), (o.get("ownership") or {}).get("averageDraftPosition"),
          (o.get("draftRanksByRankType") or {}).get("PPR"))
