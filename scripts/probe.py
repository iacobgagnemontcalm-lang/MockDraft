import re, json, requests
from bs4 import BeautifulSoup
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}
URL = "https://www.fantasypros.com/nfl/adp/ppr-overall.php"
r = requests.get(URL, headers=UA, timeout=60)
print("HTTP", r.status_code, "len", len(r.text))
soup = BeautifulSoup(r.text, "html.parser")

print("=" * 15, "TABLES")
for i, t in enumerate(soup.find_all("table")):
    hdr = [th.get_text(strip=True) for th in t.select("thead th")] or \
          [th.get_text(strip=True) for th in (t.find("tr").find_all(["th","td"]) if t.find("tr") else [])]
    print(f"[{i}] id={t.get('id')!r} class={t.get('class')!r} rows={len(t.select('tbody tr'))} hdr={hdr[:12]}")

print("=" * 15, "JS DATA BLOBS")
for m in re.finditer(r"(?:var|let|const)\s+(\w+)\s*=\s*(\{.{0,120})", r.text, re.S):
    print(f"  {m.group(1)}: {re.sub(r'[srn]+', ' ', m.group(2))[:110]!r}")
for key in ["ecrData", "adpData", "__NEXT_DATA__", "playerData"]:
    print(f"  contains {key}: {key in r.text}")

print("=" * 15, "FIRST DATA-ish ROW")
for t in soup.find_all("table"):
    tr = t.select_one("tbody tr")
    if tr and tr.select_one("a[href*='/players/']"):
        print("table id:", t.get("id"), "| class:", t.get("class"))
        print("hdr:", [th.get_text(strip=True) for th in t.select("thead th")])
        for tr in t.select("tbody tr")[:3]:
            print("   ", [td.get_text(" ", strip=True)[:28] for td in tr.find_all("td")])
        break
