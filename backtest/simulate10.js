/**
 * simulate10 — iackScore tuning on a REPAIRED harness.
 *
 * Why this file exists: simulate3–9 all parse `adp_rankings.csv` expecting the
 * old 6-column FantasyPros ADP export (`Rank,Player,Team,Bye,POS,AVG`, with POS
 * carrying a positional rank like "RB1"). That file is now 4 columns
 * (`Rank,Player (Bye),POS,AVG`) with a bare POS, so `cols.length < 6` rejects
 * EVERY row. Those sims silently draft from an empty pool and report +0.0 ± 0.0
 * for every arm. Every tuning number in the old comments predates that drift.
 *
 * Two further flaws in the old harness, independent of the parse bug:
 *   1. `ecr: parseFloat(cols[5])` set ECR := ADP, so the ECR-steal term measured
 *      `adpNoise - adp` — pure simulation noise, never real expert-vs-market
 *      disagreement. Production reads ECR from rankings.csv and ADP from
 *      adp_rankings.csv; they are different numbers.
 *   2. Truth was `projPts(posRank)`, a deterministic function of ECR order. Any
 *      signal correlated with ECR therefore looked free. Real drafts pay for
 *      being wrong.
 *
 * This harness fixes all three:
 *   - Data mirrors production: rankings.csv supplies ECR (RK), real TIERS,
 *     posRank and STD.DEV; adp_rankings.csv overlays ADP by name, using the same
 *     "Name TEAM (bye)" suffix strip as loadADPCSVText().
 *   - Truth is REALIZED points: projPts x lognormal(sigma), sigma scaled by the
 *     player's expert disagreement (STD.DEV). Draws are made once per sim and
 *     shared across arms, so arms are compared on identical outcomes.
 *   - The scorer is a faithful port of renderVOR's iackScore, including the
 *     _betterSameTierExists cliff suppression and the 3-pick look-ahead with the
 *     top-20 pre-sort and the 5-point ECR tie-break.
 *
 * Every tunable lives in a config object, so an "arm" is just an override.
 *
 * Usage:  node backtest/simulate10.js [N] [--diag] [--room=adp|sharp|both]
 */

const fs = require('fs');

// ── CSV (same quote handling as the app's parseCSVLine) ────────────────────
function parseCSVLine(line) {
  const out = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function loadRows(file) {
  const lines = fs.readFileSync(__dirname + '/../' + file, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).map(l => {
    const cells = parseCSVLine(l);
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] != null ? cells[i].trim() : ''; });
    return o;
  });
}

// Projected points curve — unchanged from simulate4-9 so results stay comparable.
function proj(pos, r) {
  const c = { QB: { b: 450, d: 0.970, f: 120 }, RB: { b: 380, d: 0.935, f: 40 },
              WR: { b: 370, d: 0.940, f: 40 },  TE: { b: 250, d: 0.910, f: 30 },
              DST:{ b: 135, d: 0.985, f: 80 },  K:  { b: 145, d: 0.985, f: 90 } }[pos]
         || { b: 370, d: 0.940, f: 40 };
  return Math.max(c.f, Math.round(c.b * Math.pow(c.d, r - 1)));
}

// ── Player pool: rankings.csv base + adp_rankings.csv overlay ──────────────
function loadPool() {
  const base = loadRows('rankings.csv').map(r => {
    const m = (r['pos'] || '').match(/^([A-Z]+)(\d+)?$/);
    if (!m) return null;
    const ecr = parseFloat(r['rk']);
    if (!isFinite(ecr)) return null;
    return {
      name: r['player name'],
      pos: m[1],
      posRank: m[2] ? parseInt(m[2], 10) : 99,
      ecr,
      tier: parseInt(r['tiers'], 10) || null,
      stdDev: parseFloat(r['std.dev']) || 0,
      adp: null,
    };
  }).filter(Boolean);

  // ADP overlay — production strips the "  DET (6)" / " DST" suffix before matching
  const byName = {};
  base.forEach(p => { byName[p.name.toLowerCase()] = p; });
  let matched = 0;
  loadRows('adp_rankings.csv').forEach(r => {
    const raw = (r['player (bye)'] || r['player'] || '')
      .replace(/\s{2,}(?:[A-Z]{2,3}\s*)?\(\d+\)\s*$/, '')
      .replace(/\s+DST$/, '')
      .trim();
    const adp = parseFloat(r['avg']);
    const p = byName[raw.toLowerCase()];
    if (p && isFinite(adp)) { p.adp = adp; matched++; }
  });

  // Players with no ADP row are deep bench; fall back to ECR so they can still
  // be drafted late but never look like market steals.
  base.forEach(p => { if (p.adp == null) p.adp = p.ecr; });
  base.forEach(p => { p.projPts = proj(p.pos, p.posRank); });

  // Tier is per-position in the app's board; rankings.csv TIERS is global.
  // Re-rank tiers within position so "next man is a worse tier" means what the
  // app means by it.
  const byPos = {};
  base.forEach(p => { (byPos[p.pos] ||= []).push(p); });
  Object.values(byPos).forEach(arr => {
    arr.sort((a, b) => a.ecr - b.ecr);
    let t = 0, prevGlobal = null;
    arr.forEach(p => { if (p.tier !== prevGlobal) { t++; prevGlobal = p.tier; } p.posTier = t; });
  });

  // STD.DEV quintile per position — identical definition to the app's
  // computeStdQuintiles(): 1 = most consensus, 5 = most contested.
  Object.values(byPos).forEach(arr => {
    const sorted = arr.filter(p => typeof p.stdDev === 'number').slice().sort((a, b) => a.stdDev - b.stdDev);
    const n = sorted.length;
    sorted.forEach((p, i) => { p.stdQuintile = Math.min(5, Math.floor((i / n) * 5) + 1); });
  });
  // Outcome-uncertainty multiplier: contested players have wider real outcomes
  base.forEach(p => { p.volMult = 0.80 + 0.125 * ((p.stdQuintile || 3) - 1); });

  if (matched < 100) throw new Error(`ADP overlay matched only ${matched} players — schema drift again?`);
  return { pool: base, matched };
}

const { pool: ALL, matched: ADP_MATCHED } = loadPool();

// ── League setup (10-team, 16-round, kicker league — the app's default) ─────
const NT = 10, NR = 16;
const TOTAL_DRAFTED = { QB: 15, RB: 40, WR: 39, TE: 16, K: 10, DST: 10 };
const SLOT_VALUE = {
  QB: [1.0, 0.50, 0.00, 0.00],
  RB: [1.0, 0.90, 0.55, 0.25, 0.10, 0.05],
  WR: [1.0, 0.90, 0.55, 0.25, 0.10, 0.05],
  TE: [1.0, 0.50, 0.00, 0.00],
  K:  [1.0, 0.02],
  DST:[1.0, 0.02],
};
const ST = { RB: 2, WR: 2, QB: 1, TE: 1 };
// Outcome volatility by position, before the STD.DEV modifier
const VOL = { QB: 0.20, RB: 0.40, WR: 0.36, TE: 0.34, K: 0.15, DST: 0.20 };

// ── RNG ────────────────────────────────────────────────────────────────────
function rng(seed) {
  let x = seed % 2147483647; if (x <= 0) x += 2147483646;
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
}
function normal(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Snake order ────────────────────────────────────────────────────────────
function draftOrder(nTeams, nRounds) {
  const o = [];
  for (let r = 1; r <= nRounds; r++) {
    const row = Array.from({ length: nTeams }, (_, i) => i);
    if (r % 2 === 0) row.reverse();
    row.forEach(t => o.push({ teamId: t, round: r }));
  }
  return o;
}
const DORDER = draftOrder(NT, NR);
function picksUntilTurn(slotIdx, teamId) {
  for (let i = slotIdx + 1; i < DORDER.length; i++) if (DORDER[i].teamId === teamId) return i - slotIdx;
  return 999;
}

// ── Lineup score on REALIZED points ────────────────────────────────────────
function score(teamPicks) {
  const bp = {};
  teamPicks.forEach(p => { (bp[p.pos] ||= []).push(p); });
  Object.values(bp).forEach(a => a.sort((x, y) => y.real - x.real));
  let t = (bp.QB?.[0]?.real || 0) + (bp.RB?.[0]?.real || 0) + (bp.RB?.[1]?.real || 0)
        + (bp.WR?.[0]?.real || 0) + (bp.WR?.[1]?.real || 0) + (bp.TE?.[0]?.real || 0);
  const flex = [bp.RB?.[2], bp.WR?.[2], bp.TE?.[1]].filter(Boolean).sort((a, b) => b.real - a.real);
  return t + (flex[0]?.real || 0);
}

// ── Default config = the shipped formula ───────────────────────────────────
const BASE_CFG = {
  needStep: 0.35,        // needMult = 1 + need * needStep
  needCap: 3,            // need = min(floor(round/2.5), needCap) - have
  needPositions: ['RB', 'WR'],
  urgencyCap: 0.30,      // the "x 0.3" tail
  depthW: 0.22,
  cliffW: 0.30,
  urgencyBase: 'abs',    // 'abs' = |mvor| (shipped) | 'pos' = max(mvor,0)
  stealDiv: 5,
  stealCap: 4,
  stealQbTeW: 0.4,
  stealMode: 'flat',     // 'flat' (shipped) | 'prop' = fraction of max(mvor,0)
  stealPropW: 0.30,
  upsideW: 0,            // bench-upside: reward outcome variance on depth picks
  discount: 0.60,        // 3-pick look-ahead per-turn discount (was 0.65; set I)
  lookahead: true,
  tieBreak: 5,           // |score gap| under which the pre-sort falls back to ECR
  scarcityW: 0.9,        // marginalValue's (1 + goneProb * scarcityW)
  dropoffW: 3.0,         // marginalValue's rawVOR + dropoff * dropoffW (was 0.5; sets G/H)
  // 'fixed2nd' reproduces the shipped marginalValue, which compares EVERY
  // candidate at a position against posAvail[1] — the 2nd-best available at
  // that position, the same player for all of them. That makes dropoff a
  // steep extra penalty for anyone further down the list, not the documented
  // "how far ahead of the next-best" bonus. 'nextman' is the documented intent.
  dropoffMode: 'fixed2nd',
};

// ── The scorer: faithful port of renderVOR ─────────────────────────────────
// Returns a function(state) -> chosen player.
function makePicker(cfg) {
  return function pick(state) {
    const { avail, picks, myTeamId, round, slotIdx, lateRounds } = state;

    const have = {};
    ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].forEach(pos => {
      have[pos] = picks.filter(p => p.teamId === myTeamId && p.pos === pos).length;
    });

    // Late-round K/DST fill, mirroring the app's candidateFilter
    if (lateRounds) {
      if (have.DST === 0) { const d = avail.find(p => p.pos === 'DST'); if (d) return d; }
      if (have.K === 0)   { const k = avail.find(p => p.pos === 'K');   if (k) return k; }
    }

    // ── computeVOR: replacement baseline from live availability ──
    const byPosEcr = {};
    avail.forEach(p => { (byPosEcr[p.pos] ||= []).push(p); });
    Object.values(byPosEcr).forEach(a => a.sort((x, y) => x.ecr - y.ecr));
    const draftedAtPos = {};
    picks.forEach(p => { draftedAtPos[p.pos] = (draftedAtPos[p.pos] || 0) + 1; });
    const replECR = {};
    Object.entries(TOTAL_DRAFTED).forEach(([pos, gN]) => {
      const list = byPosEcr[pos] || [];
      const remaining = Math.max(0, gN - (draftedAtPos[pos] || 0));
      const r = list[remaining] || list[list.length - 1];
      replECR[pos] = r ? r.ecr : 999;
    });

    // ── pick probability ──
    const adpSorted = avail.map(p => p.adpNoise).sort((a, b) => a - b);
    function remainingRank(adp) {
      let lo = 0, hi = adpSorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (adpSorted[mid] < adp) lo = mid + 1; else hi = mid; }
      return lo;
    }
    const picksAway = picksUntilTurn(slotIdx, myTeamId);
    function pickProbAt(p, offset) {
      const overshoot = offset - remainingRank(p.adpNoise);
      return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(overshoot / 4))));
    }
    // At decision time the app uses picksUntilTurn == 0 (it is my turn)
    function pickProb(p) { return pickProbAt(p, 0); }

    // ── byPos ADP-sorted: cliff / next-best source ──
    const byPosAdp = {};
    avail.forEach(p => { (byPosAdp[p.pos] ||= []).push(p); });
    Object.values(byPosAdp).forEach(a => a.sort((x, y) => x.adpNoise - y.adpNoise));

    const eliteLeft = {};
    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      eliteLeft[pos] = avail.filter(x => x.pos === pos && x.posTier <= 3).length;
    });

    function needFor(pos, haveCounts) {
      if (lateRounds || !cfg.needPositions.includes(pos)) return 0;
      return Math.max(0, Math.min(Math.floor(round / 2.5), cfg.needCap) - (haveCounts[pos] || 0));
    }

    // marginalValue + iackScore for one player under a hypothetical roster
    function iack(p, haveCounts) {
      const rE = Math.max(1, replECR[p.pos] || 150);
      const rawVOR = Math.log(rE / Math.max(1, p.ecr)) * 100;

      const sv = SLOT_VALUE[p.pos] || [0.5];
      const slotW = sv[Math.min(haveCounts[p.pos] || 0, sv.length - 1)] || 0.01;
      const posList = byPosEcr[p.pos] || [];
      let dropoff;
      if (cfg.dropoffMode === 'nextman') {
        const i = posList.indexOf(p);
        const nxt = i >= 0 ? posList[i + 1] : null;
        dropoff = nxt ? (nxt.ecr - p.ecr) : 0;   // >= 0: real gap behind him
      } else {
        const fallback = posList[1] || posList[0];
        dropoff = fallback ? (fallback.ecr - p.ecr) : 0;
      }
      const prob = pickProb(p);
      const mvor = slotW * (rawVOR + dropoff * cfg.dropoffW) * (1 + (1 - prob) * cfg.scarcityW);

      const need = needFor(p.pos, haveCounts);
      const needMult = 1 + need * cfg.needStep;
      const baseValue = Math.max(mvor, 0) * needMult + Math.min(mvor, 0);

      const goneProb = 1 - prob;
      const ecrGap = (p.adpNoise && p.ecr && p.adpNoise < 500) ? Math.max(0, p.adpNoise - p.ecr) : 0;
      const stealW = (p.pos === 'QB' || p.pos === 'TE') ? cfg.stealQbTeW : 1.0;
      const stealFrac = cfg.stealCap > 0 ? Math.min(ecrGap / cfg.stealDiv, cfg.stealCap) / cfg.stealCap : 0;
      const steal = cfg.stealMode === 'prop'
        // scale-matched: a percentage boost of the player's own value, so the
        // term keeps the same relative weight in round 1 and round 12
        ? stealFrac * Math.max(goneProb, 0.1) * stealW * Math.max(mvor, 0) * cfg.stealPropW
        : Math.min(ecrGap / cfg.stealDiv, cfg.stealCap) * Math.max(goneProb, 0.1) * stealW;

      const el = eliteLeft[p.pos] != null ? eliteLeft[p.pos] : 10;
      const depthU = (p.posTier != null && p.posTier <= 3)
        ? (el <= 2 ? 1.0 : el <= 4 ? 0.6 : el <= 6 ? 0.3 : 0.0) : 0.0;
      const adpList = byPosAdp[p.pos] || [];
      const myIdx = adpList.indexOf(p);
      const nextBest = myIdx >= 0 ? adpList[myIdx + 1] : null;
      // cliff suppression: a better same-tier option still on the board means
      // the cliff is not yet this player's problem
      const betterSameTier = myIdx > 0 &&
        adpList.slice(0, myIdx).some(x => x.posTier != null && p.posTier != null && x.posTier === p.posTier);
      const cliffU = (!betterSameTier && nextBest && p.posTier != null && nextBest.posTier != null
                      && nextBest.posTier > p.posTier) ? 0.5 : 0.0;
      const urgBase = cfg.urgencyBase === 'pos' ? Math.max(mvor, 0) : Math.abs(mvor);
      const urgency = (depthU * cfg.depthW + cliffU * cfg.cliffW) * urgBase * cfg.urgencyCap;

      // Bench upside: once a pick is roster depth rather than a starter, its
      // value is an option — it only enters the lineup if it outperforms. High
      // expert disagreement (STD.DEV quintile) is the available proxy for that
      // spread. (1 - slotW) is ~0 for starters and ~1 for deep bench, so this
      // never touches round-1 decisions.
      const upside = cfg.upsideW
        ? cfg.upsideW * (((p.stdQuintile || 3) - 3) / 2) * (1 - slotW) * 100
        : 0;

      return { s: baseValue + urgency + steal + upside, mvor, baseValue, urgency, steal, upside };
    }

    // ── candidate filter (non-late-round part of the app's) ──
    const qbCap = 2, teCap = 2;
    const cands = avail.filter(p => {
      if (p.pos === 'K' || p.pos === 'DST') return false;
      if (p.pos === 'QB' && have.QB >= qbCap) return false;
      if (p.pos === 'TE' && have.TE >= teCap) return false;
      return true;
    });
    if (!cands.length) return avail[0];

    // ── Step 1: top-20 pre-sort by iackScore with the ECR tie-break ──
    const scored = cands.map(p => ({ p, ...iack(p, have) }));
    scored.sort((a, b) => {
      if (Math.abs(a.s - b.s) < cfg.tieBreak) return (a.p.ecr || 999) - (b.p.ecr || 999);
      return b.s - a.s;
    });
    const poolTop = scored.slice(0, 20);
    if (state.diag) state.diag.push({ round, ...poolTop[0] });

    if (!cfg.lookahead) return poolTop[0].p;

    // ── Step 2: 3-pick look-ahead ──
    const picksToNext = picksAway;
    const picksToAfter = picksAway + NT;
    let best = null, bestScore = -Infinity;
    for (const cand of poolTop) {
      const p = cand.p;
      const have1 = { ...have }; have1[p.pos] = (have1[p.pos] || 0) + 1;

      const c2 = poolTop.filter(x => x.p !== p
        && !(x.p.pos === 'QB' && have1.QB >= qbCap)
        && !(x.p.pos === 'TE' && have1.TE >= teCap)
        && pickProbAt(x.p, picksToNext) > 0.35);
      let total = cand.s;
      if (c2.length) {
        let bB = null, sB = -Infinity;
        for (const x of c2) { const v = iack(x.p, have1).s; if (v > sB) { sB = v; bB = x.p; } }
        total += sB * cfg.discount;

        const have2 = { ...have1 }; have2[bB.pos] = (have2[bB.pos] || 0) + 1;
        const c3 = poolTop.filter(x => x.p !== p && x.p !== bB
          && !(x.p.pos === 'QB' && have2.QB >= qbCap)
          && !(x.p.pos === 'TE' && have2.TE >= teCap)
          && pickProbAt(x.p, picksToAfter) > 0.20);
        if (c3.length) {
          let sC = -Infinity;
          for (const x of c3) { const v = iack(x.p, have2).s; if (v > sC) sC = v; }
          total += sC * cfg.discount * cfg.discount;
        }
      }
      if (total > bestScore) { bestScore = total; best = p; }
    }
    return best || poolTop[0].p;
  };
}

// ── Bots ───────────────────────────────────────────────────────────────────
// 'adp'   — casual room: drafts near ADP with jitter (what most rooms do)
// 'sharp' — points-PAR + positional need (the simulate7 bot)
function botPick(kind, avail, picks, teamId, round, rand) {
  const have = {};
  ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].forEach(pos => {
    have[pos] = picks.filter(p => p.teamId === teamId && p.pos === pos).length;
  });
  const myPicks = picks.filter(p => p.teamId === teamId).length;
  const late = myPicks >= 13;
  if (!late && have.DST === 0 && round >= 14) { const d = avail.find(p => p.pos === 'DST'); if (d) return d; }
  if (!late && have.K === 0 && round >= 15)   { const k = avail.find(p => p.pos === 'K');   if (k) return k; }

  const ok = avail.filter(p => p.pos !== 'K' && p.pos !== 'DST'
    && !(p.pos === 'QB' && have.QB >= 2) && !(p.pos === 'TE' && have.TE >= 2));
  if (!ok.length) return avail[0];

  if (kind === 'adp') {
    // Take the best remaining by ADP, with a small reach/fall jitter
    return ok.map(p => ({ p, s: p.adpNoise * (0.93 + rand() * 0.14) }))
             .sort((a, b) => a.s - b.s)[0].p;
  }
  // sharp: points above replacement + need multiplier
  const repl = {};
  ['RB', 'WR', 'QB', 'TE'].forEach(pos => {
    const s = avail.filter(p => p.pos === pos).sort((a, b) => b.projPts - a.projPts);
    repl[pos] = (s[NT * (ST[pos] || 1)] || s[s.length - 1] || { projPts: 0 }).projPts;
  });
  const need = pos => (pos === 'RB' || pos === 'WR')
    ? (late ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - have[pos])) : 0;
  return ok.map(p => ({ p, s: (p.projPts - (repl[p.pos] || 0)) * (1 + need(p.pos) * 0.35) }))
           .sort((a, b) => b.s - a.s)[0].p;
}

// ── One draft ──────────────────────────────────────────────────────────────
function runDraft(myTeamId, picker, roomKind, sim, diag) {
  // Per-sim draws, identical across arms because the seed is the sim index
  const noiseRand = rng(sim * 7919 + 1234);
  const pool = ALL.map(p => {
    const adpNoise = p.adp * (0.85 + noiseRand() * 0.30);
    const sigma = (VOL[p.pos] || 0.35) * p.volMult;
    const z = normal(noiseRand);
    const real = p.projPts * Math.exp(sigma * z - (sigma * sigma) / 2);
    return { ...p, adpNoise, real, drafted: false };
  });
  const botRand = rng(sim * 104729 + 77);

  const picks = [];
  for (let si = 0; si < DORDER.length; si++) {
    const slot = DORDER[si];
    const avail = pool.filter(p => !p.drafted);
    if (!avail.length) break;
    let chosen;
    if (slot.teamId === myTeamId) {
      const mine = picks.filter(p => p.teamId === myTeamId).length;
      chosen = picker({
        avail, picks, myTeamId, round: slot.round, slotIdx: si,
        lateRounds: mine >= 14, diag,
      });
    } else {
      chosen = botPick(roomKind, avail, picks, slot.teamId, slot.round, botRand);
    }
    if (!chosen) chosen = avail[0];
    chosen.drafted = true;
    picks.push({ teamId: slot.teamId, pos: chosen.pos, real: chosen.real, name: chosen.name });
  }

  const teamScores = {};
  for (let t = 0; t < NT; t++) teamScores[t] = score(picks.filter(p => p.teamId === t));
  return teamScores;
}

// ── Stats ──────────────────────────────────────────────────────────────────
function stats(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, arr.length - 1));
  return { mean, se: sd / Math.sqrt(arr.length), sd };
}

module.exports = { ALL, ADP_MATCHED, BASE_CFG, makePicker, runDraft, stats, NT, rng };

// ── CLI ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const N = parseInt(args.find(a => /^\d+$/.test(a)) || '600', 10);
  const roomArg = (args.find(a => a.startsWith('--room=')) || '--room=both').split('=')[1];
  const rooms = roomArg === 'both' ? ['adp', 'sharp'] : [roomArg];
  const wantDiag = args.includes('--diag');

  console.log(`\n── simulate10 — repaired harness ──`);
  console.log(`   pool: ${ALL.length} players from rankings.csv, ${ADP_MATCHED} with real ADP`);
  console.log(`   truth: realized points (lognormal around projPts, sigma scaled by STD.DEV)`);
  console.log(`   N=${N} paired sims per arm per room\n`);

  const cfg = o => ({ ...BASE_CFG, ...o });
  const ARMS = {
    'shipped (current app)':            cfg({}),
    'urgency on max(mvor,0)':           cfg({ urgencyBase: 'pos' }),
    'steal proportional to |mvor|':     cfg({ stealMode: 'prop' }),
    'no look-ahead':                    cfg({ lookahead: false }),
    'no urgency (depth+cliff off)':     cfg({ depthW: 0, cliffW: 0 }),
    'no steal':                         cfg({ stealCap: 0 }),
    'need step 0.50':                   cfg({ needStep: 0.50 }),
    'need step 0.20':                   cfg({ needStep: 0.20 }),
    'discount 0.50':                    cfg({ discount: 0.50 }),
    'discount 0.80':                    cfg({ discount: 0.80 }),
    'urgency cap 0.6':                  cfg({ urgencyCap: 0.6 }),
    'no ECR tie-break':                 cfg({ tieBreak: 0 }),
  };

  for (const room of rooms) {
    console.log(`\n════ ${room.toUpperCase()} room ════\n`);
    const results = {};
    for (const name of Object.keys(ARMS)) results[name] = [];
    const diag = wantDiag ? [] : null;

    for (let sim = 0; sim < N; sim++) {
      const myTeamId = sim % NT;
      for (const [name, c] of Object.entries(ARMS)) {
        const ts = runDraft(myTeamId, makePicker(c), room, sim,
                            (wantDiag && name === 'shipped (current app)') ? diag : null);
        const avg = Object.values(ts).reduce((s, v) => s + v, 0) / NT;
        results[name].push(ts[myTeamId] - avg);
      }
    }

    console.log('Edge vs league average (mean ± 95% CI):\n');
    for (const name of Object.keys(ARMS)) {
      const { mean, se } = stats(results[name]);
      console.log(`  ${name.padEnd(32)} ${(mean >= 0 ? '+' : '')}${mean.toFixed(1).padStart(7)} ± ${(1.96 * se).toFixed(1)}`);
    }

    console.log('\nPaired vs shipped (same seeds, same outcome draws):\n');
    const base = 'shipped (current app)';
    for (const name of Object.keys(ARMS)) {
      if (name === base) continue;
      const d = results[name].map((v, i) => v - results[base][i]);
      const { mean, se } = stats(d);
      const ci = 1.96 * se;
      const tag = Math.abs(mean) > ci ? (mean > 0 ? '  ← BETTER' : '  ← worse') : '  (ns)';
      console.log(`  ${name.padEnd(32)} ${(mean >= 0 ? '+' : '')}${mean.toFixed(1).padStart(7)} ± ${ci.toFixed(1)}${tag}`);
    }

    if (diag && diag.length) {
      console.log('\nTerm magnitudes for the chosen pick (mean |value| by round):\n');
      const byRound = {};
      diag.forEach(d => { (byRound[d.round] ||= []).push(d); });
      console.log('  rd    base   urgency    steal   urg%   steal%');
      Object.keys(byRound).map(Number).sort((a, b) => a - b).forEach(r => {
        const g = byRound[r];
        const m = k => g.reduce((s, d) => s + Math.abs(d[k]), 0) / g.length;
        const b = m('baseValue'), u = m('urgency'), st = m('steal');
        const tot = b + u + st || 1;
        console.log(`  ${String(r).padStart(2)}  ${b.toFixed(1).padStart(6)}  ${u.toFixed(2).padStart(7)}  ${st.toFixed(2).padStart(7)}  ${(100 * u / tot).toFixed(1).padStart(5)}%  ${(100 * st / tot).toFixed(1).padStart(5)}%`);
      });
    }
  }
  console.log('');
}
