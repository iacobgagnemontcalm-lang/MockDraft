/**
 * Test three specific improvements to the simplified iackScore:
 * 1. Smarter depth urgency: elite/picks ratio instead of step function
 * 2. needMult only on positive mVOR
 * 3. Remove QB/TE steal dampening
 * Plus combinations thereof.
 */

const fs = require('fs');

function parseCSV(raw) {
  return raw.trim().split('\n').slice(1).map(line => {
    const cols = line.split(',').map(c => c.replace(/"/g,'').trim());
    if (cols.length < 6 || !cols[1]) return null;
    const m = cols[4].match(/^([A-Z]+)(\d+)?$/);
    if (!m) return null;
    return { name:cols[1], pos:m[1], posRank:m[2]?parseInt(m[2]):99, adp:parseFloat(cols[5]), ecr:parseFloat(cols[5]) };
  }).filter(Boolean);
}
function tier(pos,r){
  const t={QB:[3,8,18],RB:[8,20,40],WR:[8,20,40],TE:[4,10,20],DST:[5,15,30],K:[5,15,30]}[pos]||[8,20,40];
  return r<=t[0]?1:r<=t[1]?2:r<=t[2]?3:4;
}
function proj(pos,r){
  const c={QB:{b:450,d:0.970,f:120},RB:{b:380,d:0.935,f:40},WR:{b:370,d:0.940,f:40},TE:{b:250,d:0.910,f:30},DST:{b:135,d:0.985,f:80},K:{b:145,d:0.985,f:90}}[pos]||{b:370,d:0.940,f:40};
  return Math.max(c.f, Math.round(c.b * Math.pow(c.d, r-1)));
}

const RAW = parseCSV(fs.readFileSync(__dirname+'/../adp_rankings.csv','utf8'))
  .map(p=>({...p,tier:tier(p.pos,p.posRank),projPts:proj(p.pos,p.posRank)}));

const NT=10,NR=16,ST={RB:2,WR:2,QB:1,TE:1};
function rng(s){let x=s;return()=>{x=(x*16807)%2147483647;return(x-1)/2147483646;};}
function dOrder(n,r){const o=[];for(let i=1;i<=r;i++){const row=Array.from({length:n},(_,j)=>j);if(i%2===0)row.reverse();row.forEach(t=>o.push({teamId:t,round:i}));}return o;}
function cnt(pk,tid,pos){return pk.filter(p=>p.teamId===tid&&p.pos===pos).length;}
function mvorCalc(pool){
  const r={};
  ['RB','WR','QB','TE'].forEach(pos=>{const s=pool.filter(p=>p.pos===pos).sort((a,b)=>b.projPts-a.projPts);r[pos]=(s[NT*(ST[pos]||1)]||s[s.length-1]||{projPts:0}).projPts;});
  pool.forEach(p=>{p.mvor=(p.projPts||0)-(r[p.pos]||0);});
}
function scoreRoster(tp){
  const bp={};tp.forEach(p=>{if(!bp[p.pos])bp[p.pos]=[];bp[p.pos].push(p);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>b.projPts-a.projPts));
  let t=(bp.QB?.[0]?.projPts||0)+(bp.RB?.[0]?.projPts||0)+(bp.RB?.[1]?.projPts||0)+(bp.WR?.[0]?.projPts||0)+(bp.WR?.[1]?.projPts||0)+(bp.TE?.[0]?.projPts||0);
  return t+([bp.RB?.[2],bp.WR?.[2],bp.TE?.[1]].filter(Boolean).sort((a,b)=>b.projPts-a.projPts)[0]?.projPts||0);
}

function runDraft(myTeamId, scorerFn, rand) {
  const pool=RAW.map(p=>({...p,adpNoise:p.adp*(0.85+rand()*0.30),drafted:false,mvor:0}));
  mvorCalc(pool);
  const DO=dOrder(NT,NR);
  const picks=[];

  for(let si=0;si<DO.length;si++){
    const slot=DO[si],round=slot.round,avail=pool.filter(p=>!p.drafted),isMe=slot.teamId===myTeamId;
    let chosen;
    if(isMe){
      const have={QB:cnt(picks,myTeamId,'QB'),TE:cnt(picks,myTeamId,'TE')};
      const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K'&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2));
      chosen=cands.map(p=>({p,s:scorerFn(p,picks,DO,si,myTeamId,round,avail)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
    } else {
      const have={};['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=cnt(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      if(!lateR&&have.DST===0&&round>=14) chosen=avail.find(p=>p.pos==='DST');
      else if(!lateR&&have.K===0&&round>=15) chosen=avail.find(p=>p.pos==='K');
      else {
        const pN=pos=>pos==='RB'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.RB)):pos==='WR'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.WR)):0;
        chosen=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K'&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2))
          .map(p=>({p,s:p.mvor*(1+pN(p.pos)*0.35)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
      }
    }
    if(chosen){chosen.drafted=true;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
  }
  const ts={};for(let t=0;t<NT;t++)ts[t]=scoreRoster(picks.filter(p=>p.teamId===t));
  return ts;
}

function bench(label, scorerFn, N=600) {
  let total=0;
  for(let sim=0;sim<N;sim++){
    const rand=rng(sim*7919+1234),myTeamId=sim%NT;
    const ts=runDraft(myTeamId,scorerFn,rand);
    total+=ts[myTeamId]-Object.values(ts).reduce((s,v)=>s+v,0)/NT;
  }
  const avg=total/N, prefix=avg>=0?'+':'';
  console.log(`  ${label.padEnd(45)}  ${prefix}${avg.toFixed(1).padStart(6)} pts`);
  return avg;
}

// ── Shared helpers ─────────────────────────────────────────────────────────
function getDepthStep(p, avail) {
  const eliteLeft = avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  return (p.tier!=null&&p.tier<=3) ? (eliteLeft<=2?1.0:eliteLeft<=4?0.6:eliteLeft<=6?0.3:0.0) : 0.0;
}

function getDepthRatio(p, avail, DO, si, myTeamId) {
  // Smarter: elite remaining / max(picks until my turn, 1)
  // More elite left per pick = lower urgency; fewer = higher
  const eliteLeft = avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  if (!eliteLeft || p.tier==null || p.tier>3) return 0.0;
  let picksToMe = 0;
  for(let i=si;i<DO.length;i++){if(DO[i].teamId===myTeamId)break;if(!DO[i].playerName)picksToMe++;}
  // If 2 elite left and 8 picks before me → urgency = 2/8 = 0.25 (low)
  // If 2 elite left and 1 pick before me → urgency = 2/1 capped at 1.0 (high)
  return Math.min(1.0, eliteLeft / Math.max(picksToMe, 1));
}

function getSteal(p, avail, goneProb, dampQBTE) {
  const ecrGap = p.adp < 500 ? Math.max(0, p.adpNoise - p.ecr) : 0;
  const sw = dampQBTE && (p.pos==='QB'||p.pos==='TE') ? 0.4 : 1.0;
  return Math.min(ecrGap/5, 4) * Math.max(goneProb, 0.1) * sw;
}

function getGoneProb(p, avail, si) {
  const rem = avail.filter(x=>x.adpNoise<p.adpNoise).length;
  const ov = (avail.length - (si % NT)) - rem;
  return Math.max(0.01, Math.min(0.99, 1/(1+Math.exp(ov/4))));
}

// ── Scorer factory ─────────────────────────────────────────────────────────
function makeScorer({depthFn, needOnlyPos, dampQBTE, capMult, needWeight}) {
  return function(p, picks, DO, si, myTeamId, round, avail) {
    const mvor = p.mvor || 0;
    const goneProb = getGoneProb(p, avail, si);
    const lateR = picks.filter(x=>x.teamId===myTeamId).length>=13;
    const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'RB'));
    const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'WR'));
    const posNeed = p.pos==='RB'?rN : p.pos==='WR'?wN : 0;
    const nw = needWeight || 0.35;
    const needMult = 1 + posNeed * nw;

    let baseValue;
    if (needOnlyPos) {
      // needMult only on positive mVOR portion
      baseValue = Math.max(mvor, 0) * needMult + Math.min(mvor, 0);
    } else {
      baseValue = mvor * needMult;
    }

    const steal = getSteal(p, avail, goneProb, dampQBTE);
    const depth = depthFn(p, avail, DO, si, myTeamId);
    const cap = capMult != null ? capMult : 0.8;
    const urgencyBoost = depth * Math.abs(mvor) * cap;
    return baseValue + urgencyBoost + steal;
  };
}

// ── Baseline: current simplified iackScore ─────────────────────────────────
console.log('\n── Improvement candidates vs current simplified iackScore ──\n');

const baseline = bench('current (step depth, full needMult, QB/TE steal 0.4x)',
  makeScorer({depthFn:getDepthStep, needOnlyPos:false, dampQBTE:true, capMult:0.8}));

// ── Improvement 1: ratio-based depth ──────────────────────────────────────
bench('ratio depth (elite/picks)',
  makeScorer({depthFn:getDepthRatio, needOnlyPos:false, dampQBTE:true, capMult:0.8}));

// ── Improvement 2: needMult only on positive mVOR ─────────────────────────
bench('needMult → positive mVOR only',
  makeScorer({depthFn:getDepthStep, needOnlyPos:true, dampQBTE:true, capMult:0.8}));

// ── Improvement 3: remove QB/TE steal dampening ───────────────────────────
bench('no QB/TE steal dampening',
  makeScorer({depthFn:getDepthStep, needOnlyPos:false, dampQBTE:false, capMult:0.8}));

// ── Combined: all three improvements ─────────────────────────────────────
bench('all three combined',
  makeScorer({depthFn:getDepthRatio, needOnlyPos:true, dampQBTE:false, capMult:0.8}));

// ── Tune depth cap ────────────────────────────────────────────────────────
console.log('\n── Depth urgency cap multiplier scan (ratio depth, best settings) ──\n');
for(const cap of [0.0, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0]) {
  bench(`capMult=${cap}`,
    makeScorer({depthFn:getDepthRatio, needOnlyPos:true, dampQBTE:false, capMult:cap}));
}

// ── Tune needMult weight ──────────────────────────────────────────────────
console.log('\n── needMult weight scan (best depth + steal settings) ──\n');
for(const nw of [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50]) {
  bench(`needWeight=${nw}`,
    makeScorer({depthFn:getDepthRatio, needOnlyPos:true, dampQBTE:false, capMult:0.8, needWeight:nw}));
}

// ── Final: pure mVOR+need as reference ───────────────────────────────────
console.log('\n── Reference ──\n');
bench('pure mVOR × RB/WR need (no urgency, no steal)',
  (p,picks,DO,si,myTeamId,round,avail)=>{
    const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
    const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'RB'));
    const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'WR'));
    return p.mvor*(1+(p.pos==='RB'?rN:p.pos==='WR'?wN:0)*0.35);
  });
