#!/usr/bin/env python3
"""Daily rankings refresh for DinoMock.

Regenerates the bundled NFL ranking CSVs from their live sources:

  rankings.csv          FantasyPros PPR consensus cheatsheet (ECR + tiers)
  adp_rankings.csv      FantasyPros PPR overall ADP
  sleeper_rankings.csv  "Abusing Fantasy Draft Rankings 2026" Google Sheet,
                        Sleeper PPR tab (Sleeper site rank + Landmine score)

Each source is fetched independently — if one fails, its CSV is left
untouched (stale but valid) and the others still update. The script exits
non-zero only when every source fails.

CFL CSVs (cfl_rankings.csv / cfl_adp_rankings.csv) have no automated
source and are maintained by hand.
"""

import csv
import io
import json
import re
import sys

import requests
from bs4 import BeautifulSoup
from openpyxl import load_workbook

REPO_ROOT = re.sub(r"/scripts$", "", __import__("os").path.dirname(__import__("os").path.abspath(__file__))) or "."

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
}

ECR_URL = "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php"
ADP_URL = "https://www.fantasypros.com/nfl/adp/ppr-overall.php"
SHEET_ID = "1HTixsrRtIIpnUafVkOIhET83vCFjKXSUGiG24-5jTHY"
SHEET_XLSX_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

# Refuse to overwrite a CSV with a suspiciously small player pool — a layout
# change or half-rendered page should never clobber good data.
MIN_ECR_PLAYERS = 300
MIN_ADP_PLAYERS = 100
MIN_SHEET_PLAYERS = 100


def write_csv(path, header, rows):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def update_ecr():
    """rankings.csv from the FantasyPros PPR cheatsheet's embedded ecrData."""
    html = requests.get(ECR_URL, headers=UA, timeout=60).text
    m = re.search(r"var\s+ecrData\s*=\s*(\{.*?\})\s*;", html, re.S)
    if not m:
        raise RuntimeError("ecrData blob not found on cheatsheet page")
    players = json.loads(m.group(1))["players"]
    if len(players) < MIN_ECR_PLAYERS:
        raise RuntimeError(f"only {len(players)} players in ecrData — refusing to overwrite")

    players.sort(key=lambda p: p["rank_ecr"])
    rows = []
    for p in players:
        rows.append([
            p["rank_ecr"],
            p.get("tier", ""),
            p["player_name"],
            p.get("player_team_id", ""),
            p.get("pos_rank", p.get("player_position_id", "")),
            p.get("player_bye_week", ""),
            p.get("rank_min", ""),
            p.get("rank_max", ""),
            p.get("rank_ave", ""),
            p.get("rank_std", ""),
            p.get("player_ecr_delta", ""),
        ])
    write_csv(
        f"{REPO_ROOT}/rankings.csv",
        ["RK", "TIERS", "PLAYER NAME", "TEAM", "POS", "BYE WEEK",
         "BEST", "WORST", "AVG.", "STD.DEV", "ECR VS. ADP"],
        rows,
    )
    return len(rows)


def update_adp():
    """adp_rankings.csv from the FantasyPros PPR overall ADP table."""
    html = requests.get(ADP_URL, headers=UA, timeout=60).text
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table#data") or soup.find("table")
    if table is None:
        raise RuntimeError("no ADP table found")

    headers = [th.get_text(strip=True).upper() for th in table.select("thead th")]
    try:
        i_pos = headers.index("POS")
        i_avg = headers.index("AVG")
    except ValueError:
        raise RuntimeError(f"unexpected ADP table headers: {headers}")

    rows = []
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if len(tds) <= max(i_pos, i_avg):
            continue
        link = tr.select_one("a.player-name") or tr.select_one("td a[href*='/players/']")
        if link is None:
            continue
        name = link.get_text(strip=True)
        cell_text = tds[1].get_text(" ", strip=True)
        # Reproduce the bundled format's "Name   TEAM (BYE)" suffix, which
        # index.html's loadADPCSVText strips when matching names.
        suffix = ""
        m = re.search(r"([A-Z]{2,3})?\s*\((\d+)\)\s*$", cell_text)
        if m:
            suffix = "   " + ((m.group(1) + " ") if m.group(1) else "") + f"({m.group(2)})"
        try:
            avg = float(tds[i_avg].get_text(strip=True).replace(",", ""))
        except ValueError:
            continue
        rank = tds[0].get_text(strip=True)
        rows.append([rank, name + suffix, tds[i_pos].get_text(strip=True), avg])

    if len(rows) < MIN_ADP_PLAYERS:
        raise RuntimeError(f"only {len(rows)} ADP rows parsed — refusing to overwrite")
    write_csv(f"{REPO_ROOT}/adp_rankings.csv", ["Rank", "Player (Bye)", "POS", "AVG"], rows)
    return len(rows)


def update_sleeper_sheet():
    """sleeper_rankings.csv from the Abusing Draft Rankings sheet (Sleeper PPR tab)."""
    resp = requests.get(SHEET_XLSX_URL, headers=UA, timeout=120)
    resp.raise_for_status()
    wb = load_workbook(io.BytesIO(resp.content), read_only=True, data_only=True)

    tab = next((n for n in wb.sheetnames if re.search(r"sleeper\s*ppr", n, re.I)), None)
    if tab is None:
        raise RuntimeError(f"no 'Sleeper PPR' tab — sheets: {wb.sheetnames}")
    ws = wb[tab]
    all_rows = list(ws.iter_rows(values_only=True))

    header = [str(c).strip().lower() if c is not None else "" for c in all_rows[0]]

    def col(pattern):
        for i, h in enumerate(header):
            if re.fullmatch(pattern, h):
                return i
        raise RuntimeError(f"column /{pattern}/ not found in sheet header: {header}")

    i_name = col(r"name")
    i_team = col(r"team")
    i_bye = col(r"bye")
    i_pos = col(r"pos")
    i_fp = col(r"fantasypros")
    i_slp = col(r"sleeper(\s+adp)?")
    i_lm = col(r"landmine")

    def iv(x):
        try:
            return int(float(x))
        except (TypeError, ValueError):
            return ""

    rows = []
    for r in all_rows[1:]:
        if not r[i_name] or r[i_fp] is None or r[i_slp] is None:
            continue
        rows.append([
            str(r[i_name]).strip(),
            r[i_team] or "",
            r[i_pos] or "",
            iv(r[i_bye]),
            iv(r[i_fp]),
            iv(r[i_slp]),
            r[i_lm] if r[i_lm] is not None else "",
        ])

    if len(rows) < MIN_SHEET_PLAYERS:
        raise RuntimeError(f"only {len(rows)} sheet rows parsed — refusing to overwrite")
    write_csv(
        f"{REPO_ROOT}/sleeper_rankings.csv",
        ["PLAYER NAME", "TEAM", "POS", "BYE", "FP RANK", "SLEEPER RANK", "LANDMINE"],
        rows,
    )
    return len(rows)


def main():
    results = {}
    for label, fn in [
        ("rankings.csv (FantasyPros ECR)", update_ecr),
        ("adp_rankings.csv (FantasyPros ADP)", update_adp),
        ("sleeper_rankings.csv (Abusing Draft Rankings sheet)", update_sleeper_sheet),
    ]:
        try:
            results[label] = fn()
            print(f"OK   {label}: {results[label]} players")
        except Exception as e:
            results[label] = None
            print(f"FAIL {label}: {e}", file=sys.stderr)

    if all(v is None for v in results.values()):
        print("All sources failed — nothing updated", file=sys.stderr)
        sys.exit(1)
    failed = [k for k, v in results.items() if v is None]
    if failed:
        print(f"WARNING: {len(failed)} source(s) failed, kept previous data: {', '.join(failed)}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
