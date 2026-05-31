/**
 * iackScore backtest using real adp_rankings.csv data
 * Assigns projected points from position rank via empirical PPR curves,
 * then runs the same strategy comparison as simulate2.js
 */

const fs = require('fs');

// ── Parse CSV ──────────────────────────────────────────────────────────────
function parseCSV(raw) {
  return raw.trim().split('\n').slice(1)
    .map(line => {
      const cols = line.split(',').map(c => c.replace(/"/g,'').trim());
      if (cols.length < 6 || !cols[1]) return null;
      const posField = cols[4]; // e.g. "RB1", "WR12", "QB3", "TE1", "DST1"
      const posMatch = posField.match(/^([A-Z]+)(\d+)?$/);
      if (!posMatch) return null;
      const pos = posMatch[1];
      const posRank = posMatch[2] ? parseInt(posMatch[2]) : 99;
      const adp = parseFloat(cols[5]);
      if (isNaN(adp)) return null;
      return { name: cols[1], team: cols[2], pos, posRank, adp, ecr: adp };
    }).filter(Boolean);
}

// ── Assign tiers ───────────────────────────────────────────────────────────
function assignTier(pos, posRank) {
  const tiers = {
    QB: [3, 8, 18],
    RB: [8, 20, 40],
    WR: [8, 20, 40],
    TE: [4, 10, 20],
    DST:[5, 15, 30],
    K:  [5, 15, 30],
  };
  const t = tiers[pos] || [8, 20, 40];
  if (posRank <= t[0]) return 1;
  if (posRank <= t[1]) return 2;
  if (posRank <= t[2]) return 3;
  return 4;
}

// ── Assign projected PPR points from position rank (empirical curves) ──────
// Based on historical PPR scoring distributions, top RB ~380pts, tapering off
function assignProjPts(pos, posRank) {
  const curves = {
    QB:  { base: 450, decay: 0.970, floor: 120 },
    RB:  { base: 380, decay: 0.935, floor:  40 },
    WR:  { base: 370, decay: 0.940, floor:  40 },
    TE:  { base: 250, decay: 0.910, floor:  30 },
    DST: { base: 135, decay: 0.985, floor:  80 },
    K:   { base: 145, decay: 0.985, floor:  90 },
  };
  const c = curves[pos] || curves['WR'];
  return Math.max(c.floor, Math.round(c.base * Math.pow(c.decay, posRank - 1)));
}

// ── Load and enrich pool ───────────────────────────────────────────────────
const raw = fs.readFileSync(__dirname + '/../adp_rankings.csv', 'utf8');
const rawPool = parseCSV(raw);
rawPool.forEach(p => {
  p.tier     = assignTier(p.pos, p.posRank);
  p.projPts  = assignProjPts(p.pos, p.posRank);
});

console.log(`Loaded ${rawPool.length} players (CSV). Sample:\n`);
['QB','RB','WR','TE'].forEach(pos => {
  const top = rawPool.filter(p=>p.pos===pos).slice(0,3);
  top.forEach(p => console.log(`  ${p.name.padEnd(25)} ADP=${p.adp.toFixed(1).padStart(6)} tier=${p.tier} proj=${p.projPts}`));
});
console.log('');

// ── Sim constants ──────────────────────────────────────────────────────────
const NUM_TEAMS=10, NUM_ROUNDS=16, N_SIMS=3000;
const STARTER_THRESHOLD={RB:2,WR:2,QB:1,TE:1};
const BASE_RATES={RB:0.28,WR:0.33,QB:0.11,TE:0.11};

function rng(seed){let s=seed;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}
function buildDraftOrder(n,r){
  const o=[];
  for(let i=1;i<=r;i++){const row=Array.from({length:n},(_,j)=>j);if(i%2===0)row.reverse();row.forEach(t=>o.push({teamId:t,round:i,playerName:null}));}
  return o;
}
function tpc(picks,tid,pos){return picks.filter(p=>p.teamId===tid&&p.pos===pos).length;}

function computeMVOR(pool){
  const r={};
  ['RB','WR','QB','TE'].forEach(pos=>{
    const s=pool.filter(p=>p.pos===pos).sort((a,b)=>b.projPts-a.projPts);
    const ri=Math.min(NUM_TEAMS*(STARTER_THRESHOLD[pos]||1),s.length-1);
    r[pos]=s[ri]?s[ri].projPts:0;
  });
  pool.forEach(p=>{p.mvor=(p.projPts||0)-(r[p.pos]||0);});
}

function pickProb(p,curIdx,avail){
  if(!p.adpNoise||p.adpNoise>=500)return null;
  const rem=avail.filter(x=>x.adpNoise<p.adpNoise).length;
  const ov=(avail.length-(avail.length-curIdx))-rem;
  const overshoot=(NUM_TEAMS*2)-rem;
  const prob=1/(1+Math.exp(overshoot/4));
  return Math.max(0.01,Math.min(0.99,prob));
}

function scoreRoster(tp){
  const bp={};
  tp.forEach(p=>{if(!bp[p.pos])bp[p.pos]=[];bp[p.pos].push(p);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>b.projPts-a.projPts));
  let t=0;
  t+=(bp['QB']?.[0]?.projPts||0);
  t+=(bp['RB']?.[0]?.projPts||0)+(bp['RB']?.[1]?.projPts||0);
  t+=(bp['WR']?.[0]?.projPts||0)+(bp['WR']?.[1]?.projPts||0);
  t+=(bp['TE']?.[0]?.projPts||0);
  const fc=[bp['RB']?.[2],bp['WR']?.[2],bp['TE']?.[1]].filter(Boolean).sort((a,b)=>b.projPts-a.projPts);
  t+=(fc[0]?.projPts||0);
  return t;
}

// ── Strategies ─────────────────────────────────────────────────────────────
function stratMVOR(p){return p.mvor;}

function stratMVORNeed(p,state){
  const{picks,myTeamId,round}=state;
  const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
  const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
  const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
  const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:0;
  return p.mvor*(1+pn*0.35);
}

function stratIack(p,state){
  const{picks,draftOrder,curIdx,myTeamId,round}=state;
  const avail=state.pool.filter(x=>!x.drafted);
  const prob=pickProb(p,curIdx,avail);
  const goneProb=prob?1-prob:0.1;
  const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
  const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
  const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
  const qN=(!lateR&&tpc(picks,myTeamId,'QB')<1&&round>=6)?1:0;
  const tN=(!lateR&&tpc(picks,myTeamId,'TE')<1&&round>=5)?1:0;
  const nw={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
  const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
  const needMult=1+pn*(nw[p.pos]||0.25);
  const bp={};
  avail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
  const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
  const cliff=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
  const el=avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  const depth=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
  const rec=picks.slice(-10),rp={RB:0,WR:0,QB:0,TE:0};
  rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
  const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
  const ov=(rp[p.pos]||0)-(re[p.pos]||0);
  const run=Math.min((ov>=2?5:ov>=1?3:0)/5,1.0);
  const ot=Array.from({length:NUM_TEAMS},(_,i)=>i).filter(i=>i!==myTeamId);
  const ld=ot.length?ot.filter(t=>tpc(picks,t,p.pos)<(STARTER_THRESHOLD[p.pos]||1)).length/ot.length:0;
  let ut=0,pc=0;
  for(let i=curIdx;i<draftOrder.length;i++){
    const sl=draftOrder[i];
    if(sl.teamId===myTeamId)break;
    if(sl.playerName)continue;
    pc++;
    const tn={},tt={total:0};
    ['RB','WR','QB','TE'].forEach(pos=>{tn[pos]=Math.max(0,(STARTER_THRESHOLD[pos]||1)-tpc(picks,sl.teamId,pos));tt.total+=tn[pos];});
    ut+=tt.total>0?(tn[p.pos]||0)/tt.total:(BASE_RATES[p.pos]||0);
  }
  ut=pc>0?ut/pc:0;
  const dem=ut*0.65+ld*0.35;
  const rawU=dem*0.35+cliff*0.30+depth*0.22+run*0.13;
  const ecrGap=p.adp<500?Math.max(0,p.adpNoise-p.ecr):0;
  const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
  const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;
  return p.mvor*needMult+rawU*Math.abs(p.mvor)*0.8+steal;
}

// Proposed simplified strategy: mVOR * needMult only (best from prev simulation)
function stratSimplified(p,state){
  const{picks,myTeamId,round}=state;
  const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
  const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
  const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
  const qN=(!lateR&&tpc(picks,myTeamId,'QB')<1&&round>=6)?1:0;
  const tN=(!lateR&&tpc(picks,myTeamId,'TE')<1&&round>=5)?1:0;
  const nw={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
  const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
  const needMult=1+pn*(nw[p.pos]||0.25);
  return p.mvor*needMult;
}

const strategies=[
  ['Pure mVOR',     (p,s)=>stratMVOR(p)],
  ['mVOR+need(RB/WR)',(p,s)=>stratMVORNeed(p,s)],
  ['Simplified',    (p,s)=>stratSimplified(p,s)],
  ['iackScore',     (p,s)=>stratIack(p,s)],
];

// ── Draft runner ──────────────────────────────────────────────────────────
function runDraft(myTeamId,stratFn,rand){
  const pool=rawPool.map(p=>({...p,adpNoise:p.adp*(0.85+rand()*0.30),drafted:false,mvor:0}));
  pool.sort((a,b)=>a.adpNoise-b.adpNoise);
  computeMVOR(pool);
  const draftOrder=buildDraftOrder(NUM_TEAMS,NUM_ROUNDS);
  const picks=[];

  for(let si=0;si<draftOrder.length;si++){
    const slot=draftOrder[si];
    const round=slot.round;
    const avail=pool.filter(p=>!p.drafted);
    const isMe=slot.teamId===myTeamId;
    let chosen;

    if(isMe){
      const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K');
      const state={pool,picks,draftOrder,curIdx:si,myTeamId,round};
      const have={'QB':tpc(picks,myTeamId,'QB'),'TE':tpc(picks,myTeamId,'TE')};
      const filtered=cands.filter(p=>!(p.pos==='QB'&&have['QB']>=2)&&!(p.pos==='TE'&&have['TE']>=2));
      const scored=filtered.map(p=>({p,s:stratFn(p,state)})).sort((a,b)=>b.s-a.s);
      chosen=scored[0]?.p||avail[0];
    } else {
      const have={};
      ['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=tpc(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      if(!lateR&&have['DST']===0&&round>=14){chosen=avail.find(p=>p.pos==='DST');}
      else if(!lateR&&have['K']===0&&round>=15){chosen=avail.find(p=>p.pos==='K');}
      else{
        const sc=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K')
          .filter(p=>!(p.pos==='QB'&&have['QB']>=2)&&!(p.pos==='TE'&&have['TE']>=2))
          .map(p=>{
            const pN=p.pos==='RB'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have['RB'])):
                     p.pos==='WR'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have['WR'])):0;
            return{p,s:p.mvor*(1+pN*0.35)};
          }).sort((a,b)=>b.s-a.s);
        chosen=sc[0]?.p||avail[0];
      }
    }
    if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
  }
  const ts={};
  for(let t=0;t<NUM_TEAMS;t++)ts[t]=scoreRoster(picks.filter(p=>p.teamId===t));
  return ts;
}

// ── Run comparison ─────────────────────────────────────────────────────────
const res={};
strategies.forEach(([n])=>{res[n]={total:0,count:0,wins:0};});

for(let sim=0;sim<N_SIMS;sim++){
  const myTeamId=sim%NUM_TEAMS;
  const simD={};
  strategies.forEach(([name,fn])=>{
    const rand=rng(sim*7919+1234);
    const scores=runDraft(myTeamId,fn,rand);
    const avg=Object.values(scores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
    simD[name]=scores[myTeamId]-avg;
  });
  strategies.forEach(([name])=>{
    res[name].total+=simD[name];
    res[name].count++;
  });
  // Count wins vs iackScore
  strategies.forEach(([name])=>{
    if(name!=='iackScore'&&simD[name]>simD['iackScore']) res[name].wins++;
  });
}

console.log(`\n── Strategy comparison (${N_SIMS} sims, real 2026 ADP, 10-team PPR snake) ──\n`);
strategies.forEach(([name])=>{
  const r=res[name];
  const avg=(r.total/r.count).toFixed(1);
  const prefix=parseFloat(avg)>=0?'+':'';
  const bar=Math.abs(parseFloat(avg));
  const fill=parseFloat(avg)>=0?'█':'░';
  console.log(`  ${name.padEnd(22)} avg delta vs league=${prefix}${avg.padStart(7)} pts   wins vs iackScore: ${((r.wins||0)/N_SIMS*100).toFixed(0)}%`);
});

// ── Signal importance: measure how much each component shifts outcome ──────
console.log('\n── Signal ablation: remove one signal at a time, measure delta vs full iackScore ──\n');

const ablations=[
  ['no cliff',    (p,s,base)=>({...base, cliffUrgency:0})],
  ['no depth',    (p,s,base)=>({...base, depthUrgency:0})],
  ['no run',      (p,s,base)=>({...base, runUrgency:0})],
  ['no demand',   (p,s,base)=>({...base, demandUrgency:0})],
  ['no steal',    (p,s,base)=>({...base, stealBonus:0})],
  ['no need',     (p,s,base)=>({...base, needMult:1})],
];

function stratAblated(ablationFn){
  return function(p,state){
    const{picks,draftOrder,curIdx,myTeamId,round}=state;
    const avail=state.pool.filter(x=>!x.drafted);
    const prob=pickProb(p,curIdx,avail);
    const goneProb=prob?1-prob:0.1;
    const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
    const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
    const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
    const qN=(!lateR&&tpc(picks,myTeamId,'QB')<1&&round>=6)?1:0;
    const tN=(!lateR&&tpc(picks,myTeamId,'TE')<1&&round>=5)?1:0;
    const nw={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
    const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
    let needMult=1+pn*(nw[p.pos]||0.25);
    const bp={};
    avail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
    Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
    const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
    let cliffUrgency=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
    const el=avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
    let depthUrgency=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
    const rec=picks.slice(-10),rp={RB:0,WR:0,QB:0,TE:0};
    rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
    const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
    const ov2=(rp[p.pos]||0)-(re[p.pos]||0);
    let runUrgency=Math.min((ov2>=2?5:ov2>=1?3:0)/5,1.0);
    const ot=Array.from({length:NUM_TEAMS},(_,i)=>i).filter(i=>i!==myTeamId);
    const ld=ot.length?ot.filter(t=>tpc(picks,t,p.pos)<(STARTER_THRESHOLD[p.pos]||1)).length/ot.length:0;
    let ut=0,pc=0;
    for(let i=curIdx;i<draftOrder.length;i++){
      const sl=draftOrder[i];
      if(sl.teamId===myTeamId)break;
      if(sl.playerName)continue;
      pc++;
      const tn={},tt={total:0};
      ['RB','WR','QB','TE'].forEach(pos=>{tn[pos]=Math.max(0,(STARTER_THRESHOLD[pos]||1)-tpc(picks,sl.teamId,pos));tt.total+=tn[pos];});
      ut+=tt.total>0?(tn[p.pos]||0)/tt.total:(BASE_RATES[p.pos]||0);
    }
    ut=pc>0?ut/pc:0;
    let demandUrgency=ut*0.65+ld*0.35;
    const ecrGap=p.adp<500?Math.max(0,p.adpNoise-p.ecr):0;
    const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
    let stealBonus=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;

    const base={needMult,cliffUrgency,depthUrgency,runUrgency,demandUrgency,stealBonus};
    const adj=ablationFn(p,state,base);
    const rawU=adj.demandUrgency*0.35+adj.cliffUrgency*0.30+adj.depthUrgency*0.22+adj.runUrgency*0.13;
    return p.mvor*adj.needMult+rawU*Math.abs(p.mvor)*0.8+adj.stealBonus;
  };
}

const ablRes={};
ablations.forEach(([n])=>{ablRes[n]={total:0,count:0};});

for(let sim=0;sim<1000;sim++){
  const myTeamId=sim%NUM_TEAMS;
  const rand0=rng(sim*7919+1234);
  const baseScores=runDraft(myTeamId,(p,s)=>stratIack(p,s),rand0);
  const baseAvg=Object.values(baseScores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
  const baseDelta=baseScores[myTeamId]-baseAvg;

  ablations.forEach(([name,fn])=>{
    const rand=rng(sim*7919+1234);
    const scores=runDraft(myTeamId,stratAblated(fn),rand);
    const avg=Object.values(scores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
    ablRes[name].total+=(scores[myTeamId]-avg)-baseDelta;
    ablRes[name].count++;
  });
}

ablations.forEach(([name])=>{
  const r=ablRes[name];
  const avg=(r.total/r.count).toFixed(2);
  const prefix=parseFloat(avg)>=0?'+':'';
  const dir=parseFloat(avg)>=0?'▲ hurts removing it':'▼ helps removing it';
  console.log(`  Remove ${name.padEnd(12)}  delta change vs full iackScore: ${prefix}${avg} pts   ${dir}`);
});

// ── Optimal weights grid search ────────────────────────────────────────────
console.log('\n── Urgency signal weight optimization (500 sims each) ──\n');
console.log('  Testing: rawUrgency = demand*Wd + cliff*Wc + depth*Wz + run*Wr\n');

const weightCombos=[
  [0.35, 0.30, 0.22, 0.13, 'current'],
  [0.00, 0.00, 0.00, 0.00, 'no urgency (pure mVOR*need)'],
  [0.50, 0.20, 0.20, 0.10, 'demand-heavy'],
  [0.10, 0.50, 0.25, 0.15, 'cliff-heavy'],
  [0.10, 0.20, 0.50, 0.20, 'depth-heavy'],
  [0.10, 0.15, 0.15, 0.60, 'run-heavy'],
  [0.25, 0.40, 0.25, 0.10, 'cliff+demand balanced'],
  [0.20, 0.20, 0.20, 0.40, 'run-leaning'],
];

weightCombos.forEach(([wd,wc,wz,wr,label])=>{
  const stratFn=(p,state)=>{
    const{picks,draftOrder,curIdx,myTeamId,round}=state;
    const avail=state.pool.filter(x=>!x.drafted);
    const prob=pickProb(p,curIdx,avail);
    const goneProb=prob?1-prob:0.1;
    const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
    const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
    const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
    const qN=(!lateR&&tpc(picks,myTeamId,'QB')<1&&round>=6)?1:0;
    const tN=(!lateR&&tpc(picks,myTeamId,'TE')<1&&round>=5)?1:0;
    const nwt={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
    const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
    const needMult=1+pn*(nwt[p.pos]||0.25);
    const bp={};
    avail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
    Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
    const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
    const cliff=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
    const el=avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
    const depth=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
    const rec=picks.slice(-10),rp={RB:0,WR:0,QB:0,TE:0};
    rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
    const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
    const ov=(rp[p.pos]||0)-(re[p.pos]||0);
    const run=Math.min((ov>=2?5:ov>=1?3:0)/5,1.0);
    const ot=Array.from({length:NUM_TEAMS},(_,i)=>i).filter(i=>i!==myTeamId);
    const ld=ot.length?ot.filter(t=>tpc(picks,t,p.pos)<(STARTER_THRESHOLD[p.pos]||1)).length/ot.length:0;
    let ut=0,pc=0;
    for(let i=curIdx;i<draftOrder.length;i++){
      const sl=draftOrder[i];
      if(sl.teamId===myTeamId)break;
      if(sl.playerName)continue;
      pc++;
      const tn={},tt={total:0};
      ['RB','WR','QB','TE'].forEach(pos=>{tn[pos]=Math.max(0,(STARTER_THRESHOLD[pos]||1)-tpc(picks,sl.teamId,pos));tt.total+=tn[pos];});
      ut+=tt.total>0?(tn[p.pos]||0)/tt.total:(BASE_RATES[p.pos]||0);
    }
    ut=pc>0?ut/pc:0;
    const dem=ut*0.65+ld*0.35;
    const rawU=dem*wd+cliff*wc+depth*wz+run*wr;
    const ecrGap=p.adp<500?Math.max(0,p.adpNoise-p.ecr):0;
    const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
    const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;
    return p.mvor*needMult+rawU*Math.abs(p.mvor)*0.8+steal;
  };
  let total=0,count=0;
  for(let sim=0;sim<500;sim++){
    const rand=rng(sim*7919+1234);
    const myTeamId=sim%NUM_TEAMS;
    const scores=runDraft(myTeamId,stratFn,rand);
    const avg=Object.values(scores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
    total+=scores[myTeamId]-avg;
    count++;
  }
  const avg=(total/count).toFixed(1);
  const prefix=parseFloat(avg)>=0?'+':'';
  console.log(`  [${wd.toFixed(2)} ${wc.toFixed(2)} ${wz.toFixed(2)} ${wr.toFixed(2)}]  ${prefix}${avg.padStart(6)} pts   ${label}`);
});
