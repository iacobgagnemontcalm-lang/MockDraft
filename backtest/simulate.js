/**
 * iackScore backtest — synthetic 2026 PPR ADP pool, 10-team snake draft
 *
 * For each of N simulated drafts:
 *   - Shuffle ADP noise (±15%) to vary pick order
 *   - Run 16-round snake draft; my team picks at a random slot (1–10)
 *   - At each of MY picks, record which iackScore signals were active
 *   - Score each team's final roster via a simple fantasy point model
 *   - Track: did acting on a signal produce a better final team score?
 *
 * Output: correlation of each signal with team score improvement
 */

// ── Player pool ────────────────────────────────────────────────────────────
// [name, pos, adp, ecr, tier, projPts]  (PPR, 10-team, 2026 estimates)
const POOL = [
  // RB Tier 1
  ['Christian McCaffrey','RB',1,1,1,380],['Bijan Robinson','RB',2,2,1,355],
  ['Breece Hall','RB',4,3,1,345],['Jahmyr Gibbs','RB',5,5,1,335],
  ['De\'Von Achane','RB',6,4,1,340],['Jonathan Taylor','RB',8,7,1,310],
  // WR Tier 1
  ['CeeDee Lamb','WR',3,3,1,370],['Ja\'Marr Chase','WR',7,6,1,350],
  ['Justin Jefferson','WR',9,8,1,340],['Tyreek Hill','WR',12,10,1,310],
  // RB Tier 2
  ['Tony Pollard','RB',10,9,2,285],['Saquon Barkley','RB',11,11,2,290],
  ['Josh Jacobs','RB',14,13,2,275],['Travis Etienne','RB',15,14,2,270],
  ['Rhamondre Stevenson','RB',18,16,2,260],['David Montgomery','RB',20,18,2,255],
  ['Derrick Henry','RB',22,21,2,250],['Aaron Jones','RB',24,23,2,245],
  // WR Tier 2
  ['Amon-Ra St. Brown','WR',13,12,2,310],['Stefon Diggs','WR',16,15,2,295],
  ['Davante Adams','WR',17,17,2,300],['A.J. Brown','WR',19,19,2,295],
  ['Cooper Kupp','WR',21,20,2,285],['DK Metcalf','WR',23,22,2,280],
  ['Puka Nacua','WR',25,24,2,275],['Deebo Samuel','WR',27,26,2,265],
  // TE Tier 1
  ['Sam LaPorta','TE',26,25,1,220],['Travis Kelce','TE',28,28,1,230],
  ['Mark Andrews','TE',30,29,1,215],['Dallas Goedert','TE',33,31,1,205],
  // QB Tier 1
  ['Josh Allen','QB',29,27,1,400],['Lamar Jackson','QB',32,30,1,395],
  ['Patrick Mahomes','QB',35,33,1,385],
  // RB Tier 3
  ['Zach Charbonnet','RB',34,34,3,220],['Isiah Pacheco','RB',36,36,3,215],
  ['Brian Robinson','RB',38,37,3,210],['Rachaad White','RB',40,39,3,205],
  ['Kyren Williams','RB',42,41,3,200],['Miles Sanders','RB',44,43,3,195],
  ['Dameon Pierce','RB',46,45,3,190],['Tyler Allgeier','RB',48,47,3,185],
  ['Javonte Williams','RB',50,49,3,180],['James Conner','RB',52,51,3,175],
  ['Najee Harris','RB',54,53,3,170],['Tyjae Spears','RB',56,55,3,165],
  ['Clyde Edwards-Helaire','RB',58,57,3,160],['Khalil Herbert','RB',60,59,3,155],
  ['AJ Dillon','RB',62,61,3,150],['Jamaal Williams','RB',64,63,3,145],
  ['D\'Andre Swift','RB',66,65,3,140],['Elijah Mitchell','RB',68,67,3,135],
  // WR Tier 3
  ['Keenan Allen','WR',31,32,3,255],['Chris Olave','WR',37,35,3,250],
  ['Tee Higgins','WR',39,38,3,245],['Michael Pittman','WR',41,40,3,240],
  ['Garrett Wilson','WR',43,42,3,235],['Jordan Addison','WR',45,44,3,230],
  ['Jaylen Waddle','WR',47,46,3,225],['Zay Flowers','WR',49,48,3,220],
  ['Christian Kirk','WR',51,50,3,215],['Marquise Brown','WR',53,52,3,210],
  ['Courtland Sutton','WR',55,54,3,205],['George Pickens','WR',57,56,3,200],
  ['Diontae Johnson','WR',59,58,3,195],['Adam Thielen','WR',61,60,3,185],
  ['Tyler Lockett','WR',63,62,3,180],['Drake London','WR',65,64,3,175],
  ['Rashee Rice','WR',67,66,3,170],['Quentin Johnston','WR',69,68,3,165],
  // TE Tier 2
  ['Kyle Pitts','TE',70,70,2,185],['Trey McBride','TE',72,71,2,180],
  ['Evan Engram','TE',74,73,2,175],['Jake Ferguson','TE',76,75,2,170],
  ['Pat Freiermuth','TE',78,77,2,165],['Cole Kmet','TE',80,79,2,160],
  ['Dalton Kincaid','TE',82,81,2,155],['T.J. Hockenson','TE',84,83,2,150],
  // QB Tier 2
  ['Jalen Hurts','QB',71,69,2,370],['Joe Burrow','QB',73,72,2,355],
  ['Dak Prescott','QB',75,74,2,345],['Justin Herbert','QB',77,76,2,340],
  ['Tua Tagovailoa','QB',79,78,2,335],['Jared Goff','QB',81,80,2,320],
  ['Trevor Lawrence','QB',83,82,2,315],['Anthony Richardson','QB',85,84,2,310],
  // Depth / rounds 7–12
  ['Rashid Shaheed','WR',86,86,4,140],['Odell Beckham Jr.','WR',88,87,4,135],
  ['Darnell Mooney','WR',90,89,4,130],['Wan\'Dale Robinson','WR',92,91,4,125],
  ['Romeo Doubs','WR',94,93,4,120],['Jaxon Smith-Njigba','WR',96,95,4,120],
  ['Elijah Moore','WR',98,97,4,115],['Brandin Cooks','WR',100,99,4,110],
  ['Kadarius Toney','WR',102,101,4,108],['Gabe Davis','WR',104,103,4,105],
  ['Skyy Moore','WR',106,105,4,102],['K.J. Osborn','WR',108,107,4,100],
  ['Boston Scott','RB',87,88,4,110],['Damien Harris','RB',89,90,4,105],
  ['Latavius Murray','RB',91,92,4,100],['Tony Jones Jr.','RB',93,94,4,95],
  ['Matt Breida','RB',95,96,4,90],['Marlon Mack','RB',97,98,4,85],
  ['Cam Akers','RB',99,100,4,80],['Craig Reynolds','RB',101,102,4,78],
  ['Ty Montgomery','RB',103,104,4,75],['Kenyan Drake','RB',105,106,4,72],
  ['Sony Michel','RB',107,108,4,70],['Phillip Lindsay','RB',109,110,4,68],
  ['Will Dissly','TE',110,109,3,120],['Noah Fant','TE',112,111,3,115],
  ['Foster Moreau','TE',114,113,3,110],['Gerald Everett','TE',116,115,3,105],
  ['Hayden Hurst','TE',118,117,3,100],['Juwan Johnson','TE',120,119,3,95],
  ['Daniel Bellinger','TE',122,121,3,90],['Dawson Knox','TE',124,123,3,88],
  ['Derek Carr','QB',111,112,3,290],['Ryan Tannehill','QB',113,114,3,280],
  ['Kirk Cousins','QB',115,116,3,275],['Geno Smith','QB',117,118,3,270],
  ['Jordan Love','QB',119,120,3,265],['Sam Howell','QB',121,122,3,260],
  ['Bryce Young','QB',123,124,3,255],['CJ Stroud','QB',125,126,3,250],
  // Rounds 13–16 depth
  ['Deon Jackson','RB',126,127,5,60],['Tyrion Davis-Price','RB',128,129,5,55],
  ['Dare Ogunbowale','RB',130,131,5,50],['Ronnie Rivers','RB',132,133,5,48],
  ['Eno Benjamin','RB',134,135,5,45],['Devine Ozigbo','RB',136,137,5,42],
  ['Dontrell Hilliard','RB',138,139,5,40],['Hassan Haskins','RB',140,141,5,38],
  ['Marquez Callaway','WR',127,128,5,65],['Anthony Miller','WR',129,130,5,62],
  ['Parris Campbell','WR',131,132,5,60],['Velus Jones Jr.','WR',133,134,5,58],
  ['Tre Tucker','WR',135,136,5,55],['Josh Reynolds','WR',137,138,5,52],
  ['Collin Johnson','WR',139,140,5,50],['Equanimeous St. Brown','WR',141,142,5,48],
  ['Irv Smith Jr.','TE',142,143,5,70],['Tyler Conklin','TE',144,145,5,65],
  ['Geoff Swaim','TE',146,147,5,60],['Tommy Tremble','TE',148,149,5,55],
  ['DST1','DST',143,144,4,120],['DST2','DST',150,150,4,115],
  ['K1','K',155,155,4,140],['K2','K',160,160,4,135],
];

// ── Config ─────────────────────────────────────────────────────────────────
const NUM_TEAMS   = 10;
const NUM_ROUNDS  = 16;
const N_SIMS      = 2000;
const STARTER_THRESHOLD = { RB:2, WR:2, QB:1, TE:1 };
const BASE_RATES  = { RB:0.28, WR:0.33, QB:0.11, TE:0.11 };

// ── Helpers ─────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function buildDraftOrder(numTeams, numRounds) {
  const order = [];
  for (let r = 1; r <= numRounds; r++) {
    const row = Array.from({length: numTeams}, (_,i) => i);
    if (r % 2 === 0) row.reverse();
    row.forEach(t => order.push({teamId: t, round: r, playerName: null}));
  }
  return order;
}

function teamPosCount(picks, teamId, pos) {
  return picks.filter(p => p.teamId === teamId && p.pos === pos).length;
}

function computePickProb(player, curIdx, draftOrder, pool) {
  const adp = player.adpNoise;
  if (!adp || adp >= 200) return null;
  const remaining = pool.filter(p => !p.drafted && p.adpNoise < adp).length;
  const overshoot = (draftOrder.length - curIdx) - remaining;
  const prob = 1 / (1 + Math.exp(overshoot / 4));
  return Math.max(0.01, Math.min(0.99, prob));
}

// Simple mVOR: proj points above positional replacement (50th percentile of starters)
function computeMVOR(pool) {
  const replPts = {};
  ['RB','WR','QB','TE'].forEach(pos => {
    const sorted = pool.filter(p => p.pos === pos).sort((a,b) => b.projPts - a.projPts);
    const replIdx = Math.min(NUM_TEAMS * STARTER_THRESHOLD[pos], sorted.length - 1);
    replPts[pos] = sorted[replIdx] ? sorted[replIdx].projPts : 0;
  });
  pool.forEach(p => { p.mvor = (p.projPts || 0) - (replPts[p.pos] || 0); });
}

// ── iackScore signals (extracted from app logic) ──────────────────────────
function computeSignals(p, state) {
  const { pool, picks, draftOrder, curIdx, myTeamId, round } = state;
  const available = pool.filter(x => !x.drafted);

  // goneProb
  const prob = computePickProb(p, curIdx, draftOrder, available);
  const goneProb = prob !== null ? (1 - prob) : 0.1;

  // byPos
  const byPos = {};
  available.forEach(x => { if (!byPos[x.pos]) byPos[x.pos] = []; byPos[x.pos].push(x); });
  Object.values(byPos).forEach(arr => arr.sort((a,b) => a.adpNoise - b.adpNoise));

  // cliffUrgency
  const posList = byPos[p.pos] || [];
  const nextAtPos = posList.find(x => x.name !== p.name);
  const cliffUrgency = (nextAtPos && p.tier != null && nextAtPos.tier != null && nextAtPos.tier > p.tier) ? 1.0 : 0.0;

  // depthUrgency
  const posElite = available.filter(x => x.pos === p.pos && x.tier <= 3).length;
  const isElite = p.tier != null && p.tier <= 3;
  const depthUrgency = isElite ? (posElite <= 2 ? 1.0 : posElite <= 4 ? 0.6 : posElite <= 6 ? 0.3 : 0.0) : 0.0;

  // runUrgency (last 10 picks)
  const recentPicks = picks.slice(-10);
  const recentPos = { RB:0, WR:0, QB:0, TE:0 };
  recentPicks.forEach(pk => { if (recentPos[pk.pos] !== undefined) recentPos[pk.pos]++; });
  const runExp = { RB:2.8, WR:3.3, QB:1.1, TE:1.1 };
  const over = (recentPos[p.pos] || 0) - (runExp[p.pos] || 0);
  const rawRun = over >= 2 ? 5 : over >= 1 ? 3 : 0;
  const runUrgency = Math.min(rawRun / 5, 1.0);

  // leagueDemand
  const otherTeams = Array.from({length: NUM_TEAMS}, (_,i) => i).filter(i => i !== myTeamId);
  const needyLeague = otherTeams.filter(t => teamPosCount(picks, t, p.pos) < (STARTER_THRESHOLD[p.pos] || 1)).length;
  const leagueDemand = otherTeams.length ? needyLeague / otherTeams.length : 0;

  // upcomingThreat (probability model)
  let upcomingThreat = 0;
  let pickCount = 0;
  for (let i = curIdx; i < draftOrder.length; i++) {
    const slot = draftOrder[i];
    if (slot.teamId === myTeamId) break;
    if (slot.playerName) continue;
    pickCount++;
    const tNeeds = {};
    let tTotal = 0;
    ['RB','WR','QB','TE'].forEach(pos => {
      const n = Math.max(0, (STARTER_THRESHOLD[pos]||1) - teamPosCount(picks, slot.teamId, pos));
      tNeeds[pos] = n; tTotal += n;
    });
    upcomingThreat += tTotal > 0 ? (tNeeds[p.pos] || 0) / tTotal : (BASE_RATES[p.pos] || 0);
  }
  upcomingThreat = pickCount > 0 ? upcomingThreat / pickCount : 0;

  const demandUrgency = upcomingThreat * 0.65 + leagueDemand * 0.35;

  // needMult
  const myRB = teamPosCount(picks, myTeamId, 'RB');
  const myWR = teamPosCount(picks, myTeamId, 'WR');
  const myQB = teamPosCount(picks, myTeamId, 'QB');
  const myTE = teamPosCount(picks, myTeamId, 'TE');
  const lateRounds = picks.filter(pk => pk.teamId === myTeamId).length >= 13;
  const rbNeed = lateRounds ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - myRB);
  const wrNeed = lateRounds ? 0 : Math.max(0, Math.min(Math.floor(round / 2.5), 3) - myWR);
  const qbNeed = (!lateRounds && myQB < 1 && round >= 6) ? 1 : 0;
  const teNeed = (!lateRounds && myTE < 1 && round >= 5) ? 1 : 0;
  const needWeights = { RB:0.35, WR:0.35, QB:0.20, TE:0.18 };
  const posNeed = p.pos==='RB' ? rbNeed : p.pos==='WR' ? wrNeed : p.pos==='QB' ? qbNeed : p.pos==='TE' ? teNeed : 0;
  const needMult = 1 + posNeed * (needWeights[p.pos] || 0.25);

  // ECR steal
  const ecrGap = p.adp < 200 ? Math.max(0, p.adpNoise - p.ecr) : 0;
  const stealWeight = (p.pos === 'QB' || p.pos === 'TE') ? 0.4 : 1.0;
  const stealBonus = Math.min(ecrGap / 5, 4) * Math.max(goneProb, 0.1) * stealWeight;

  const baseValue = p.mvor * needMult;
  const rawUrgency = demandUrgency*0.35 + cliffUrgency*0.30 + depthUrgency*0.22 + runUrgency*0.13;
  const urgencyBoost = rawUrgency * Math.abs(p.mvor) * 0.8;
  const iackScore = baseValue + urgencyBoost + stealBonus;

  return {
    iackScore, baseValue, urgencyBoost, stealBonus,
    goneProb, cliffUrgency, depthUrgency, runUrgency,
    leagueDemand, upcomingThreat, demandUrgency, rawUrgency,
    needMult, mvor: p.mvor,
  };
}

// ── Auto-pick for non-my teams ─────────────────────────────────────────────
function autoPick(teamId, pool, picks, draftOrder, curIdx, round) {
  const available = pool.filter(p => !p.drafted);
  const have = {};
  ['RB','WR','QB','TE','DST','K'].forEach(pos => {
    have[pos] = teamPosCount(picks, teamId, pos);
  });
  const lateRounds = picks.filter(p => p.teamId === teamId).length >= 13;

  // Force DST/K in late rounds
  if (!lateRounds) {
    if (have['DST'] === 0 && round >= 14) return available.find(p => p.pos === 'DST');
    if (have['K'] === 0 && round >= 15) return available.find(p => p.pos === 'K');
  }

  // Score available players by simple VOR + need
  const scored = available
    .filter(p => p.pos !== 'DST' && p.pos !== 'K')
    .map(p => {
      const need = {
        RB: lateRounds ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - have['RB']),
        WR: lateRounds ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - have['WR']),
        QB: (!lateRounds && have['QB'] < 1 && round >= 6) ? 1 : 0,
        TE: (!lateRounds && have['TE'] < 1 && round >= 5) ? 1 : 0,
      }[p.pos] || 0;
      const prob = computePickProb(p, curIdx, draftOrder, available);
      const goneProb = prob ? 1 - prob : 0.1;
      const needW = { RB:0.35, WR:0.35, QB:0.20, TE:0.18 }[p.pos] || 0.2;
      // Cap positions
      if (have['QB'] >= 2 && p.pos === 'QB') return {p, score: -999};
      if (have['TE'] >= 2 && p.pos === 'TE') return {p, score: -999};
      const score = p.mvor * (1 + need * needW) + goneProb * Math.abs(p.mvor) * 0.3;
      return {p, score};
    });

  scored.sort((a,b) => b.score - a.score);
  return scored[0]?.p || available[0];
}

// ── Score a team's final roster ────────────────────────────────────────────
function scoreRoster(teamPicks) {
  const byPos = {};
  teamPicks.forEach(p => { if (!byPos[p.pos]) byPos[p.pos] = []; byPos[p.pos].push(p); });
  Object.values(byPos).forEach(arr => arr.sort((a,b) => b.projPts - a.projPts));

  let total = 0;
  // Starters: 1QB, 2RB, 2WR, 1TE, 1FLEX (best remaining RB/WR/TE)
  total += (byPos['QB']?.[0]?.projPts || 0);
  total += (byPos['RB']?.[0]?.projPts || 0) + (byPos['RB']?.[1]?.projPts || 0);
  total += (byPos['WR']?.[0]?.projPts || 0) + (byPos['WR']?.[1]?.projPts || 0);
  total += (byPos['TE']?.[0]?.projPts || 0);
  // FLEX: best of RB[2], WR[2], TE[1]
  const flexCandidates = [byPos['RB']?.[2], byPos['WR']?.[2], byPos['TE']?.[1]].filter(Boolean);
  flexCandidates.sort((a,b) => b.projPts - a.projPts);
  total += (flexCandidates[0]?.projPts || 0);
  return total;
}

// ── Main simulation ─────────────────────────────────────────────────────────
const signalNames = [
  'mvor','baseValue','urgencyBoost','stealBonus',
  'goneProb','cliffUrgency','depthUrgency','runUrgency',
  'leagueDemand','upcomingThreat','demandUrgency','rawUrgency','needMult',
];

// Accumulate: for each pick, signal values and resulting "did this pick beat average?"
const signalData = [];   // array of {signal: val, delta: teamScore - leagueAvg}

let totalSims = 0;

for (let sim = 0; sim < N_SIMS; sim++) {
  const rand = rng(sim * 7919 + 1234);
  const myTeamId = Math.floor(rand() * NUM_TEAMS);

  // Build player pool with ADP noise
  const pool = POOL.map(([name, pos, adp, ecr, tier, projPts]) => ({
    name, pos, adp, ecr, tier, projPts,
    adpNoise: adp * (0.85 + rand() * 0.30),  // ±15% noise
    drafted: false, mvor: 0,
  }));
  pool.sort((a,b) => a.adpNoise - b.adpNoise);
  computeMVOR(pool);

  const draftOrder = buildDraftOrder(NUM_TEAMS, NUM_ROUNDS);
  const picks = [];  // {teamId, pos, projPts, name, ...signals}

  for (let slotIdx = 0; slotIdx < draftOrder.length; slotIdx++) {
    const slot = draftOrder[slotIdx];
    const round = slot.round;
    const isMyPick = slot.teamId === myTeamId;

    let chosen;
    if (isMyPick) {
      // My pick: use iackScore, but also record the signals for every available player
      // and track which one we actually picked vs alternatives
      const available = pool.filter(p => !p.drafted && p.pos !== 'DST' && p.pos !== 'K');
      const state = { pool, picks, draftOrder, curIdx: slotIdx, myTeamId, round };

      const scored = available.map(p => ({
        p,
        sig: computeSignals(p, state),
      })).sort((a,b) => b.sig.iackScore - a.sig.iackScore);

      chosen = scored[0]?.p;
      if (!chosen) {
        chosen = pool.find(p => !p.drafted);
      }
      if (chosen) {
        // Record the top pick's signals for later correlation analysis
        const sig = scored[0]?.sig;
        if (sig) signalData.push({sig, sim, round});
      }
    } else {
      chosen = autoPick(slot.teamId, pool, picks, draftOrder, slotIdx, round);
    }

    if (chosen) {
      chosen.drafted = true;
      slot.playerName = chosen.name;
      picks.push({teamId: slot.teamId, pos: chosen.pos, projPts: chosen.projPts,
                  name: chosen.name, round});
    }
  }

  // Score all teams
  const teamScores = {};
  for (let t = 0; t < NUM_TEAMS; t++) {
    teamScores[t] = scoreRoster(picks.filter(p => p.teamId === t));
  }
  const leagueAvg = Object.values(teamScores).reduce((s,v) => s+v, 0) / NUM_TEAMS;
  const myScore   = teamScores[myTeamId];
  const delta     = myScore - leagueAvg;

  // Tag each signal record from this sim with the outcome delta
  signalData.filter(d => d.sim === sim).forEach(d => { d.delta = delta; });
  totalSims++;
}

// ── Correlation analysis ────────────────────────────────────────────────────
// For each signal, compute Pearson r between signal value at pick time and final team delta
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s,v) => s+v, 0) / n;
  const my = ys.reduce((s,v) => s+v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  return dx2 && dy2 ? num / Math.sqrt(dx2 * dy2) : 0;
}

const valid = signalData.filter(d => d.delta !== undefined);
console.log(`\nSimulations: ${totalSims}  |  Pick observations: ${valid.length}\n`);
console.log('Signal correlation with final team score (vs league avg):\n');

const results = signalNames.map(name => {
  const xs = valid.map(d => d.sig[name] || 0);
  const ys = valid.map(d => d.delta);
  const r  = pearson(xs, ys);
  return {name, r};
}).sort((a,b) => Math.abs(b.r) - Math.abs(a.r));

results.forEach(({name, r}) => {
  const bar = '█'.repeat(Math.round(Math.abs(r) * 60));
  const dir = r >= 0 ? '+' : '-';
  console.log(`  ${name.padEnd(16)} ${dir}${bar.padEnd(35)} r=${r.toFixed(4)}`);
});

// Also: measure urgencyBoost / baseValue ratio — does urgency help or hurt when it dominates?
const dominated = valid.filter(d => Math.abs(d.sig.urgencyBoost) > Math.abs(d.sig.baseValue));
const notDom    = valid.filter(d => Math.abs(d.sig.urgencyBoost) <= Math.abs(d.sig.baseValue));
const avgDomDelta    = dominated.length ? dominated.reduce((s,d) => s+d.delta, 0)/dominated.length : 0;
const avgNotDomDelta = notDom.length    ? notDom.reduce((s,d) => s+d.delta, 0)/notDom.length : 0;
console.log(`\nWhen urgency > value: avg outcome delta = ${avgDomDelta.toFixed(1)} pts  (n=${dominated.length})`);
console.log(`When value >= urgency: avg outcome delta = ${avgNotDomDelta.toFixed(1)} pts  (n=${notDom.length})`);

// Also: are the current urgency weights optimal? Try a grid search on demandUrgency weight
console.log('\n── Urgency weight sensitivity (demandUrgency weight scan) ──');
[0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6].forEach(w => {
  const adjusted = valid.map(d => {
    const s = d.sig;
    const rawU = s.demandUrgency * w + s.cliffUrgency * 0.30 + s.depthUrgency * 0.22 + s.runUrgency * 0.13;
    const newScore = s.baseValue + rawU * Math.abs(s.mvor) * 0.8 + s.stealBonus;
    return {score: newScore, delta: d.delta};
  });
  // Rank teams by score, measure rank correlation
  const r = pearson(adjusted.map(d => d.score), adjusted.map(d => d.delta));
  console.log(`  demandW=${w.toFixed(2)}  r=${r.toFixed(4)}`);
});
