/**
 * sweep10 — parameter sweeps on the repaired simulate10 harness.
 *
 * simulate10's diagnostic showed the shipped formula has a scale-matching
 * problem: baseValue runs ~470 in round 1 and ~0.4 by round 14, while the ECR
 * steal bonus is a flat 0–4 points. So steal is 0.1% of the decision when picks
 * matter and 40% of it when they don't. Urgency does not have this problem —
 * it is already multiplied by |mvor|.
 *
 * Sweeps here:
 *   A. steal: flat (shipped) vs scale-matched proportional, weight swept
 *   B. bench upside: reward STD.DEV-quintile variance on depth picks only
 *   C. the two combined, plus look-ahead / discount re-checks
 *
 * Usage: node backtest/sweep10.js [N] [--room=adp|sharp|both] [--set=A|B|C]
 */

const { BASE_CFG, makePicker, runDraft, stats, NT } = require('./simulate10.js');

const args = process.argv.slice(2);
const N = parseInt(args.find(a => /^\d+$/.test(a)) || '800', 10);
const roomArg = (args.find(a => a.startsWith('--room=')) || '--room=both').split('=')[1];
const setArg = (args.find(a => a.startsWith('--set=')) || '--set=C').split('=')[1];
const rooms = roomArg === 'both' ? ['adp', 'sharp'] : [roomArg];

const cfg = o => ({ ...BASE_CFG, ...o });

const SETS = {
  A: {
    'shipped (flat steal)':        cfg({}),
    'steal off':                   cfg({ stealCap: 0 }),
    'prop steal w=0.05':           cfg({ stealMode: 'prop', stealPropW: 0.05 }),
    'prop steal w=0.10':           cfg({ stealMode: 'prop', stealPropW: 0.10 }),
    'prop steal w=0.20':           cfg({ stealMode: 'prop', stealPropW: 0.20 }),
    'prop steal w=0.35':           cfg({ stealMode: 'prop', stealPropW: 0.35 }),
  },
  B: {
    'shipped (no upside)':         cfg({}),
    'upside w=0.25':               cfg({ upsideW: 0.25 }),
    'upside w=0.50':               cfg({ upsideW: 0.50 }),
    'upside w=1.00':               cfg({ upsideW: 1.00 }),
    'upside w=2.00':               cfg({ upsideW: 2.00 }),
    'upside w=-1.00 (prefer safe)':cfg({ upsideW: -1.00 }),
  },
  D: {
    'shipped (dropoff=fixed2nd)':  cfg({}),
    'dropoff=nextman w=0.5':       cfg({ dropoffMode: 'nextman' }),
    'dropoff=nextman w=1.0':       cfg({ dropoffMode: 'nextman', dropoffW: 1.0 }),
    'dropoff=nextman w=2.0':       cfg({ dropoffMode: 'nextman', dropoffW: 2.0 }),
    'dropoff off (w=0)':           cfg({ dropoffW: 0 }),
    'fixed2nd w=1.0':              cfg({ dropoffW: 1.0 }),
  },
  E: {
    'shipped (no upside)':         cfg({}),
    'upside w=0.05':               cfg({ upsideW: 0.05 }),
    'upside w=0.10':               cfg({ upsideW: 0.10 }),
    'upside w=0.15':               cfg({ upsideW: 0.15 }),
    'upside w=0.20':               cfg({ upsideW: 0.20 }),
    'upside w=0.25':               cfg({ upsideW: 0.25 }),
    'upside w=0.30':               cfg({ upsideW: 0.30 }),
    'upside w=0.35':               cfg({ upsideW: 0.35 }),
  },
  // Re-validate the shipped constants. Every one of these was justified in an
  // index.html comment by a backtest that ran on the broken harness.
  F: {
    'shipped':                     cfg({}),
    'no look-ahead':               cfg({ lookahead: false }),
    'discount 0.50':               cfg({ discount: 0.50 }),
    'discount 0.80':               cfg({ discount: 0.80 }),
    'needStep 0.20':               cfg({ needStep: 0.20 }),
    'needStep 0.50':               cfg({ needStep: 0.50 }),
    'need off (0)':                cfg({ needStep: 0 }),
    'urgency off':                 cfg({ depthW: 0, cliffW: 0 }),
    'depth off (cliff only)':      cfg({ depthW: 0 }),
    'cliff off (depth only)':      cfg({ cliffW: 0 }),
    'urgencyCap 0.15':             cfg({ urgencyCap: 0.15 }),
    'urgencyCap 0.60':             cfg({ urgencyCap: 0.60 }),
  },
  C: {
    'shipped':                     cfg({}),
    'prop steal 0.10':             cfg({ stealMode: 'prop', stealPropW: 0.10 }),
    'upside 0.50':                 cfg({ upsideW: 0.50 }),
    'prop steal 0.10 + upside 0.5':cfg({ stealMode: 'prop', stealPropW: 0.10, upsideW: 0.50 }),
    'no look-ahead':               cfg({ lookahead: false }),
    'discount 0.50':               cfg({ discount: 0.50 }),
    'combined + discount 0.50':    cfg({ stealMode: 'prop', stealPropW: 0.10, upsideW: 0.50, discount: 0.50 }),
  },
};

const ARMS = SETS[setArg] || SETS.C;
const BASE_NAME = Object.keys(ARMS)[0];

console.log(`\n── sweep10 set ${setArg}, N=${N}, rooms=${rooms.join('+')} ──\n`);

for (const room of rooms) {
  console.log(`════ ${room.toUpperCase()} room ════\n`);
  const results = {};
  for (const name of Object.keys(ARMS)) results[name] = [];

  for (let sim = 0; sim < N; sim++) {
    const myTeamId = sim % NT;
    for (const [name, c] of Object.entries(ARMS)) {
      const ts = runDraft(myTeamId, makePicker(c), room, sim, null);
      const avg = Object.values(ts).reduce((s, v) => s + v, 0) / NT;
      results[name].push(ts[myTeamId] - avg);
    }
  }

  console.log(`Paired vs "${BASE_NAME}" (identical seeds and outcome draws):\n`);
  for (const name of Object.keys(ARMS)) {
    const { mean: em } = stats(results[name]);
    if (name === BASE_NAME) {
      console.log(`  ${name.padEnd(30)} edge ${em.toFixed(1).padStart(7)}   (reference)`);
      continue;
    }
    const d = results[name].map((v, i) => v - results[BASE_NAME][i]);
    const { mean, se } = stats(d);
    const ci = 1.96 * se;
    const tag = Math.abs(mean) > ci ? (mean > 0 ? ' ← BETTER' : ' ← worse') : ' (ns)';
    console.log(`  ${name.padEnd(30)} edge ${em.toFixed(1).padStart(7)}   Δ ${(mean >= 0 ? '+' : '')}${mean.toFixed(2).padStart(6)} ± ${ci.toFixed(2)}${tag}`);
  }
  console.log('');
}
