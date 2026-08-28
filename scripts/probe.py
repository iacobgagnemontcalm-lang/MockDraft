import re, json, requests
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}

print("="*15, "ecrData player keys (cheatsheets page we already parse)")
html = requests.get("https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
                    headers=UA, timeout=60).text
m = re.search(r"var\s+ecrData\s*=\s*(\{.*?\})\s*;", html, re.S)
players = json.loads(m.group(1))["players"]
print("count:", len(players))
print("keys:", sorted(players[0].keys()))
print("sample:", json.dumps({k: players[0][k] for k in sorted(players[0])}, indent=1)[:900])

print("="*15, "any ADP-ish keys?")
adpish = [k for k in players[0] if "adp" in k.lower() or "avg" in k.lower() or "ave" in k.lower()]
print(adpish, "->", {k: players[0][k] for k in adpish})

print("="*15, "adp cheatsheet page variant")
for url in ["https://www.fantasypros.com/nfl/adp/ppr-cheatsheets.php",
            "https://www.fantasypros.com/nfl/adp/ppr-overall.php?print=true"]:
    try:
        t = requests.get(url, headers=UA, timeout=60)
        blobs = re.findall(r"var\s+(\w*[Dd]ata)\s*=\s*\{", t.text)
        print(f"  {url} -> HTTP {t.status_code} len={len(t.text)} blobs={blobs}")
    except Exception as e:
        print(f"  {url} -> EXC {e}")

print("="*15, "FantasyPros public API")
key = None
for m2 in re.finditer(r'["\']([0-9a-zA-Z]{20,40})["\']', html):
    pass
mk = re.search(r'x-api-key["\']\s*[:=]\s*["\']([^"\']+)["\']', html)
print("inline x-api-key in page:", mk.group(1) if mk else None)
api = ("https://api.fantasypros.com/v2/json/nfl/2026/consensus-rankings"
       "?type=adp&scoring=PPR&position=ALL&week=0")
r = requests.get(api, headers=UA, timeout=45)
print("no-key ->", r.status_code, r.text[:200])
