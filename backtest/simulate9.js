/**
 * simulate9 — Should the app's rawVOR switch from log-rank to points-above-replacement?
 *
 * Prior sims (simulate4-8) validated iackScore using a points-based mvor
 * (projPts − replacement projPts). The APP, however, ships a different value
 * engine: rawVOR = log(replECR/playerECR)×100, wrapped in slot weights and a
 * pick-probability scarcity multiplier (marginalValue in index.html). The
 * validated numbers therefore never measured what production runs.
 *
 * This sim replicates the app's full pick pipeline faithfully and A/Bs ONLY
 * the rawVOR formula, with paired seeds (identical bot rooms per sim) so the
 * comparison is a true paired test with a standard error.
 *
 * Arms:
 *   A. log-rank VOR          (current app)
 *   B. points VOR            (proposed swap)
 *   C. points VOR + urgency scaled by max(mvor,0) instead of |mvor| (sign fix)
 *   Ref. plain points mvor + needMult (the simulate7 bot/baseline strategy)
 */

const fs = require('fs');

// ── Data (same conventions as simulate7) ───────────────────────────────────
function parseCSV(raw) {
  return raw.trim().split('\n').slice(1).map(line => {
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    if (cols.length < 6 || !cols[1]) return null;
    const m = cols[4].match(/^([A-Z]+)(\d+)?$/);
    if (!m) return null;
    return { name: cols[1], pos: m[1], posRank: m[2] ? parseInt(m[2]) : 99, adp: parseFloat(cols[5]), ecr: parseFloat(cols[5]) };
  }).filter(Boolean);
}
function tier(pos, r) {
  const t = { QB: [3, 8, 18], RB: [8, 20, 40], WR: [8, 20, 40], TE: [4, 10, 20], DST: [5, 15, 30], K: [5, 15, 30] }[pos] || [8, 20, 40];
  return r <= t[0] ? 1 : r <= t[1] ? 2 : r <= t[2] ? 3 : 4;
}
function proj(pos, r) {
  const c = { QB: { b: 450, d: 0.970, f: 120 }, RB: { b: 380, d: 0.935, f: 40 }, WR: { b: 370, d: 0.940, f: 40 }, TE: { b: 250, d: 0.910, f: 30 }, DST: { b: 135, d: 0.985, f: 80 }, K: { b: 145, d: 0.985, f: 90 } }[pos] || { b: 370, d: 0.940, f: 40 };
  return Math.max(c.f, Math.round(c.b * Math.pow(c.d, r - 1)));
}
const RAW = parseCSV(fs.readFileSync(__dirname + '/../adp_rankings.csv', 'utf8'))
  .map(p => ({ ...p, tier: tier(p.pos, p.posRank), projPts: proj(p.pos, p.posRank) }));

// ── League setup ───────────────────────────────────────────────────────────
const NT = 10, NR = 16, ST = { RB: 2, WR: 2, QB: 1, TE: 1 };
const TOTAL_DRAFTED = { QB: 15, RB: 40, WR: 39, TE: 16 };           // app's table
const SLOT_VALUE = {                                                 // app's table
  QB: [1.0, 0.50, 0.00, 0.00],
  RB: [1.0, 0.90, 0.55, 0.25, 0.10, 0.05],
  WR: [1.0, 0.90, 0.55, 0.25, 0.10, 0.05],
  TE: [1.0, 0.50, 0.00, 0.00],
  K:  [1.0, 0.02],
  DST:[1.0, 0.02],
};

function rng(s) { let x = s; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }
function dOrder(n, r) { const o = []; for (let i = 1; i <= r; i++) { const row = Array.from({ length: n }, (_, j) => j); if (i % 2 === 0) row.reverse(); row.forEach(t => o.push({ teamId: t, round: i, playerName: null })); } return o; }
function cnt(picks, tid, pos) { return picks.filter(p => p.teamId === tid && p.pos === pos).length; }

// Bot value engine: plain points-PAR (identical to simulate7's bots)
function botMvor(pool) {
  const r = {};
  ['RB', 'WR', 'QB', 'TE'].forEach(pos => {
    const s = pool.filter(p => !p.drafted && p.pos === pos).sort((a, b) => b.projPts - a.projPts);
    r[pos] = (s[NT * (ST[pos] || 1)] || s[s.length - 1] || { projPts: 0 }).projPts;
  });
  pool.forEach(p => { p.botMvor = (p.projPts || 0) - (r[p.pos] || 0); });
}

// Team result: starters' projected points (QB,RB×2,WR×2,TE,FLEX) — same as simulate7
function score(tp) {
  const bp = {}; tp.forEach(p => { (bp[p.pos] ||= []).push(p); });
  Object.values(bp).forEach(a => a.sort((a, b) => b.projPts - a.projPts));
  let t = (bp.QB?.[0]?.projPts || 0) + (bp.RB?.[0]?.projPts || 0) + (bp.RB?.[1]?.projPts || 0)
        + (bp.WR?.[0]?.projPts || 0) + (bp.WR?.[1]?.projPts || 0) + (bp.TE?.[0]?.projPts || 0);
  const fc = [bp.RB?.[2], bp.WR?.[2], bp.TE?.[1]].filter(Boolean).sort((a, b) => b.projPts - a.projPts);
  return t + (fc[0]?.projPts || 0);
}

// ── App pipeline replica ───────────────────────────────────────────────────
// Scores all candidates for MY pick. vorMode: 'log' | 'pts'.
// urgencyOnPositive: scale urgency by max(mvor,0) instead of |mvor|.
function appPickScores(cands, avail, picks, myTeamId, round, vorMode, urgencyOnPositive) {
  // byPos ECR-sorted — replacement + dropoff source (app computeVOR)
  const byPosEcr = {};
  avail.forEach(p => { (byPosEcr[p.pos] ||= []).push(p); });
  Object.values(byPosEcr).forEach(a => a.sort((x, y) => x.ecr - y.ecr));

  // Replacement player per position: Nth best available, N = league demand remaining
  const draftedAtPos = {};
  picks.forEach(p => { draftedAtPos[p.pos] = (draftedAtPos[p.pos] || 0) + 1; });
  const repl = {};
  Object.entries(TOTAL_DRAFTED).forEach(([pos, gN]) => {
    const list = byPosEcr[pos] || [];
    const remaining = Math.max(0, gN - (draftedAtPos[pos] || 0));
    repl[pos] = list[remaining] || list[list.length - 1] || null;
  });

  // byPos ADP-sorted — cliff/next-best source (app renderVOR)
  const byPosAdp = {};
  avail.forEach(p => { (byPosAdp[p.pos] ||= []).push(p); });
  Object.values(byPosAdp).forEach(a => a.sort((x, y) => x.adpNoise - y.adpNoise));

  // Elite-left per position (tier ≤ 3 still available)
  const eliteLeft = {};
  ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
    eliteLeft[pos] = avail.filter(x => x.pos === pos && x.tier <= 3).length;
  });

  // Sorted available ADP for remaining-rank lookups
  const adpSorted = avail.map(p => p.adpNoise).sort((a, b) => a - b);
  function remainingRank(adp) {
    let lo = 0, hi = adpSorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (adpSorted[mid] < adp) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // App computePickProb at decision time: picksAway = 0 (it's my turn)
  function pickProb(p) {
    const overshoot = 0 - remainingRank(p.adpNoise);
    return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(overshoot / 4))));
  }

  const have = {};
  ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].forEach(pos => { have[pos] = cnt(picks, myTeamId, pos); });
  const lateR = picks.filter(x => x.teamId === myTeamId).length >= 13;
  const rbNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - have.RB);
  const wrNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - have.WR);

  return cands.map(p => {
    // ── rawVOR: the ONLY thing that differs between arms ──
    const r = repl[p.pos];
    let rawVOR;
    if (vorMode === 'log') {
      const rE = Math.max(1, r ? r.ecr : 150);
      rawVOR = Math.log(rE / Math.max(1, p.ecr)) * 100;
    } else {
      rawVOR = (p.projPts || 0) - (r ? (r.projPts || 0) : 0);
    }

    // ── marginalValue: slotW × (rawVOR + dropoff×0.5) × scarcity ──
    const sv = SLOT_VALUE[p.pos] || [0.5];
    const slotW = sv[Math.min(have[p.pos] || 0, sv.length - 1)] || 0.01;
    const posList = byPosEcr[p.pos] || [];
    const fallback = posList[1] || posList[0];
    const dropoff = !fallback ? 0
      : vorMode === 'log' ? (fallback.ecr - p.ecr)
      : ((p.projPts || 0) - (fallback.projPts || 0));
    const prob = pickProb(p);
    const scarcity = 1 + (1 - prob) * 0.9;
    const mvor = slotW * (rawVOR + dropoff * 0.5) * scarcity;

    // ── iackScore wrapper (app renderVOR) ──
    const needMult = 1 + (p.pos === 'RB' ? rbNeed : p.pos === 'WR' ? wrNeed : 0) * 0.35;
    const baseValue = Math.max(mvor, 0) * needMult + Math.min(mvor, 0);

    const goneProb = 1 - prob;
    const ecrGap = Math.max(0, p.adpNoise - p.ecr);
    const stealW = (p.pos === 'QB' || p.pos === 'TE') ? 0.4 : 1.0;
    const steal = Math.min(ecrGap / 5, 4) * Math.max(goneProb, 0.1) * stealW;

    const el = eliteLeft[p.pos] != null ? eliteLeft[p.pos] : 10;
    const depthU = (p.tier <= 3) ? (el <= 2 ? 1.0 : el <= 4 ? 0.6 : el <= 6 ? 0.3 : 0.0) : 0.0;
    const adpList = byPosAdp[p.pos] || [];
    const myIdx = adpList.indexOf(p);
    const nextBest = myIdx >= 0 ? adpList[myIdx + 1] : null;
    const cliffU = (nextBest && nextBest.tier > p.tier) ? 0.5 : 0.0;
    const urgencyBase = urgencyOnPositive ? Math.max(mvor, 0) : Math.abs(mvor);
    const urgency = (depthU * 0.22 + cliffU * 0.30) * urgencyBase * 0.3;

    return { p, s: baseValue + urgency + steal };
  });
}

// ── Draft loop (bots identical to simulate7) ───────────────────────────────
function runDraft(myTeamId, myScorer, rand) {
  const pool = RAW.map(p => ({ ...p, adpNoise: p.adp * (0.85 + rand() * 0.30), drafted: false, botMvor: 0 }));
  const DO = dOrder(NT, NR);
  const picks = [];
  for (let si = 0; si < DO.length; si++) {
    const slot = DO[si], round = slot.round;
    const avail = pool.filter(p => !p.drafted);
    let chosen;
    if (slot.teamId === myTeamId) {
      const have = { QB: cnt(picks, myTeamId, 'QB'), TE: cnt(picks, myTeamId, 'TE') };
      const cands = avail.filter(p => p.pos !== 'DST' && p.pos !== 'K'
        && !(p.pos === 'QB' && have.QB >= 2) && !(p.pos === 'TE' && have.TE >= 2));
      chosen = myScorer(cands, avail, picks, myTeamId, round).sort((a, b) => b.s - a.s)[0]?.p || avail[0];
    } else {
      botMvor(pool);
      const have = {}; ['RB', 'WR', 'QB', 'TE', 'DST', 'K'].forEach(pos => { have[pos] = cnt(picks, slot.teamId, pos); });
      const lateR = picks.filter(p => p.teamId === slot.teamId).length >= 13;
      if (!lateR && have.DST === 0 && round >= 14) chosen = avail.find(p => p.pos === 'DST');
      else if (!lateR && have.K === 0 && round >= 15) chosen = avail.find(p => p.pos === 'K');
      else {
        const pN = pos => (pos === 'RB' || pos === 'WR')
          ? (lateR ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - have[pos])) : 0;
        chosen = avail.filter(p => p.pos !== 'DST' && p.pos !== 'K'
          && !(p.pos === 'QB' && have.QB >= 2) && !(p.pos === 'TE' && have.TE >= 2))
          .map(p => ({ p, s: p.botMvor * (1 + pN(p.pos) * 0.35) }))
          .sort((a, b) => b.s - a.s)[0]?.p || avail[0];
      }
    }
    if (chosen) { chosen.drafted = true; slot.playerName = chosen.name; picks.push({ teamId: slot.teamId, pos: chosen.pos, projPts: chosen.projPts, name: chosen.name }); }
  }
  const ts = {}; for (let t = 0; t < NT; t++) ts[t] = score(picks.filter(p => p.teamId === t));
  return ts;
}

// ── Arms ───────────────────────────────────────────────────────────────────
const ARMS = {
  'log-rank VOR (current app)':        (c, a, pk, me, rd) => appPickScores(c, a, pk, me, rd, 'log', false),
  'points VOR':                        (c, a, pk, me, rd) => appPickScores(c, a, pk, me, rd, 'pts', false),
  'points VOR + urgency on max(m,0)':  (c, a, pk, me, rd) => appPickScores(c, a, pk, me, rd, 'pts', true),
  'plain points mvor + needMult (ref)': (c, a, pk, me, rd) => {
    // simulate7 bot strategy as a sanity anchor
    const lateR = pk.filter(x => x.teamId === me).length >= 13;
    const have = { RB: cnt(pk, me, 'RB'), WR: cnt(pk, me, 'WR') };
    const need = pos => (pos === 'RB' || pos === 'WR')
      ? (lateR ? 0 : Math.max(0, Math.min(Math.floor(rd / 2.5), 3) - have[pos])) : 0;
    const r = {};
    ['RB', 'WR', 'QB', 'TE'].forEach(pos => {
      const s = a.filter(p => p.pos === pos).sort((x, y) => y.projPts - x.projPts);
      r[pos] = (s[NT * (ST[pos] || 1)] || s[s.length - 1] || { projPts: 0 }).projPts;
    });
    return c.map(p => ({ p, s: ((p.projPts || 0) - (r[p.pos] || 0)) * (1 + need(p.pos) * 0.35) }));
  },
};

// ── Paired benchmark ───────────────────────────────────────────────────────
const N = parseInt(process.argv[2] || '2000', 10);
console.log(`\n── simulate9: rawVOR formula A/B — app pipeline replica, paired seeds, N=${N} ──\n`);

const results = {}; // arm -> per-sim (myScore − leagueAvg)
for (const arm of Object.keys(ARMS)) results[arm] = [];

for (let sim = 0; sim < N; sim++) {
  const myTeamId = sim % NT;
  for (const [arm, scorer] of Object.entries(ARMS)) {
    const rand = rng(sim * 7919 + 1234); // identical seed per sim across arms
    const ts = runDraft(myTeamId, scorer, rand);
    const avg = Object.values(ts).reduce((s, v) => s + v, 0) / NT;
    results[arm].push(ts[myTeamId] - avg);
  }
}

function stats(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1));
  return { mean, se: sd / Math.sqrt(arr.length) };
}

console.log('Edge vs league average (mean ± 95% CI):\n');
for (const arm of Object.keys(ARMS)) {
  const { mean, se } = stats(results[arm]);
  console.log(`  ${arm.padEnd(38)} ${(mean >= 0 ? '+' : '')}${mean.toFixed(1).padStart(6)} ± ${(1.96 * se).toFixed(1)} pts`);
}

console.log('\nPaired differences (same seeds, mean ± 95% CI):\n');
const base = 'log-rank VOR (current app)';
for (const arm of Object.keys(ARMS)) {
  if (arm === base) continue;
  const diffs = results[arm].map((v, i) => v - results[base][i]);
  const { mean, se } = stats(diffs);
  const sig = Math.abs(mean) > 1.96 * se ? '  ← significant' : '  (not significant)';
  console.log(`  ${arm.padEnd(38)} ${(mean >= 0 ? '+' : '')}${mean.toFixed(1).padStart(6)} ± ${(1.96 * se).toFixed(1)} pts vs current${sig}`);
}

// How much does the app's wrapper (slotW × scarcity × urgency × steal) add
// over the bare points-PAR strategy the bots use?
const ptsArm = 'points VOR';
const refArm = 'plain points mvor + needMult (ref)';
const wDiffs = results[ptsArm].map((v, i) => v - results[refArm][i]);
const w = stats(wDiffs);
console.log(`\n  app wrapper vs bare points-PAR        ${(w.mean >= 0 ? '+' : '')}${w.mean.toFixed(1).padStart(6)} ± ${(1.96 * w.se).toFixed(1)} pts ${Math.abs(w.mean) > 1.96 * w.se ? ' ← significant' : ' (not significant)'}`);
console.log('');
