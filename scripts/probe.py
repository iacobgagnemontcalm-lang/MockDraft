import json, re, requests
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}
base = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nfl/players"
numeric = nonnum = 0
samples = []
for start in range(0, 500, 25):
    path = (f"{base};position=ALL;start={start};count=25;sort=rank_season;"
            f"search=;out=draft_analysis;ranks=season/draft_analysis")
    r = requests.get(path, params={"format": "json_f"}, headers={**UA, "Accept": "application/json"}, timeout=45)
    vals = re.findall(r'"average_pick"\s*:\s*("?[^,"}]*"?)', r.text)
    pn, pnn = 0, 0
    for v in vals:
        v = v.strip('"')
        try:
            f = float(v)
            if f > 0: pn += 1
            else: pnn += 1
        except ValueError:
            pnn += 1
            if len(samples) < 5: samples.append(v)
    numeric += pn; nonnum += pnn
    print(f"start={start}: numeric={pn} non-numeric={pn and pnn or pnn}")
print("TOTAL numeric:", numeric, "non-numeric:", nonnum, "sample non-numeric:", samples)

# one full player object
r = requests.get(f"{base};position=ALL;start=0;count=2;sort=rank_season;search=;out=draft_analysis;ranks=season/draft_analysis",
                 params={"format": "json_f"}, headers={**UA, "Accept": "application/json"}, timeout=45)
d = r.json()
def find(n):
    if isinstance(n, dict):
        if "draft_analysis" in n: return n
        for v in n.values():
            f = find(v)
            if f: return f
    elif isinstance(n, list):
        for v in n:
            f = find(v)
            if f: return f
print("PLAYER OBJ:", json.dumps(find(d), indent=1)[:1200])
