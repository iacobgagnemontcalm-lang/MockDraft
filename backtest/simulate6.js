// Test: does cap=0.3 with various signal combos beat our current simplified scorer?
// Current = depth+steal, no QB/TE need, cap=0.8

const fs = require('fs'), path = require('path');
const csv = fs.readFileSync(path.join(__dirname,'../adp_rankings.csv'),'utf8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',').map(s=>s.trim());
const RAW = lines.slice(1).map(row=>{
  const c=row.split(',').map(s=>s.trim()); const o={};
  header.forEach((h,i)=>o[h]=c[i]);
  return {name:o.name||o.Name,pos:(o.pos||o.Pos||'').toUpperCase(),
    adp:parseFloat(o.adp||o.ADP||999),ecr:parseFloat(o.ecr||o.ECR||o.adp||999),
    projPts:parseFloat(o.projPts||o.proj||o.Proj||0),tier:parseInt(o.tier||o.Tier||5)};
}).filter(p=>p.name&&p.adp<400&&['QB','RB','WR','TE'].includes(p.pos));

const NT=10, NR=16;
function rng(seed){let s=seed;return()=>{s=(s*1664525+1013904223)&0xffffffff;return(s>>>0)/4294967296;};}
function mvor(pool){
  const byPos={QB:[],RB:[],WR:[],TE:[]};
  pool.forEach(p=>byPos[p.pos]&&byPos[p.pos].push(p));
  const repl={QB:2,RB:5,WR:5,TE:2};
  Object.entries(byPos).forEach(([pos,arr])=>{
    arr.sort((a,b)=>b.projPts-a.projPts);
    const threshold=arr[repl[pos]]?.projPts||arr[arr.length-1]?.projPts||0;
    arr.forEach(p=>{p.mvor=parseFloat((p.projPts-threshold).toFixed(1));});
  });
}
function dOrder(nt,nr){const o=[];for(let r=0;r<nr;r++){const row=[];for(let t=0;t<nt;t++)row.push(t);if(r%2===1)row.reverse();row.forEach((t,i)=>o.push({teamId:t,round:r+1,pick:r*nt+i+1,playerName:null}));}return o;}
function cnt(picks,tid,pos){return picks.filter(p=>p.teamId===tid&&p.pos===pos).length;}
function score(picks){
  const byPos={};picks.forEach(p=>{if(!byPos[p.pos])byPos[p.pos]=[];byPos[p.pos].push(p.projPts);});
  Object.values(byPos).forEach(a=>a.sort((a,b)=>b-a));
  const get=(pos,n)=>(byPos[pos]||[]).slice(0,n).reduce((s,v)=>s+v,0);
  return get('QB',1)+get('RB',2)+get('WR',2)+get('TE',1)+Math.max(...['RB','WR','TE'].map(p=>(byPos[p]||[])[2]||0));
}

function makeScorer(opts) {
  // opts: {depth, cliff, run, steal, capMult, positiveMVOR}
  return function(p, state) {
    const {picks, curIdx, myTeamId, round} = state;
    const avail = state.pool.filter(x=>!x.drafted);
    const mvor = p.mvor || 0;

    // Need mult: RB/WR only
    const rbHave = cnt(picks, myTeamId, 'RB'), wrHave = cnt(picks, myTeamId, 'WR');
    const lateR = picks.filter(x=>x.teamId===myTeamId).length >= 13;
    const rbNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - rbHave);
    const wrNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - wrHave);
    const needMult = 1 + (p.pos==='RB' ? rbNeed : p.pos==='WR' ? wrNeed : 0) * 0.35;
    // Apply to positive mVOR only (backtest improvement)
    const baseValue = opts.positiveMVOR
      ? Math.max(mvor,0)*needMult + Math.min(mvor,0)
      : mvor * needMult;

    // Depth urgency
    let depthU = 0;
    if (opts.depth && p.tier != null && p.tier <= 3) {
      const eliteLeft = avail.filter(x=>x.pos===p.pos&&x.tier!=null&&x.tier<=3).length;
      depthU = eliteLeft<=2 ? 1.0 : eliteLeft<=4 ? 0.6 : eliteLeft<=6 ? 0.3 : 0.0;
    }

    // Cliff urgency
    let cliffU = 0;
    if (opts.cliff && p.tier != null) {
      const sorted = avail.filter(x=>x.pos===p.pos).sort((a,b)=>(a.ecr||999)-(b.ecr||999));
      const next = sorted.find(x=>x.name!==p.name);
      if (next && next.tier > p.tier) cliffU = 0.5;
    }

    // Run urgency (recent picks at same pos)
    let runU = 0;
    if (opts.run) {
      const recent = picks.slice(-6);
      const recentPos = recent.filter(x=>x.pos===p.pos).length;
      runU = recentPos >= 3 ? 0.5 : recentPos >= 2 ? 0.3 : 0;
    }

    const cap = opts.capMult != null ? opts.capMult : 0.8;
    const rawU = (opts.depth?depthU:0)*0.22 + (opts.cliff?cliffU:0)*0.30 + (opts.run?runU:0)*0.13;
    const urgencyBoost = rawU * Math.abs(mvor) * cap;

    // ECR steal
    let stealBonus = 0;
    if (opts.steal) {
      const ecrGap = (p.adp && p.ecr && p.adp < 500) ? Math.max(0, p.adp - p.ecr) : 0;
      const stealW = (p.pos==='QB'||p.pos==='TE') ? 0.4 : 1.0;
      // Approximate goneProb without full sigmoid: use ADP vs remaining
      const picksLeft = picks.filter(x=>x.teamId===myTeamId).length;
      const goneProb = 0.2; // simplified
      stealBonus = Math.min(ecrGap/5, 4) * Math.max(goneProb, 0.1) * stealW;
    }

    return baseValue + urgencyBoost + stealBonus;
  };
}

function runDraft(myTeamId, scorerFn, rand) {
  const pool=RAW.map(p=>({...p,adpNoise:p.adp*(0.85+rand()*0.30),drafted:false,mvor:0}));
  mvor(pool);
  const DO=dOrder(NT,NR);
  const picks=[];
  for(let si=0;si<DO.length;si++){
    const slot=DO[si],round=slot.round,avail=pool.filter(p=>!p.drafted),isMe=slot.teamId===myTeamId;
    let chosen;
    if(isMe){
      const have={QB:cnt(picks,myTeamId,'QB'),TE:cnt(picks,myTeamId,'TE')};
      const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K'&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2));
      const state={pool,picks,curIdx:si,myTeamId,round};
      chosen=cands.map(p=>({p,s:scorerFn(p,state)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
    } else {
      const have={};['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=cnt(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      if(!lateR&&have.DST===0&&round>=14) chosen=avail.find(p=>p.pos==='DST');
      else if(!lateR&&have.K===0&&round>=15) chosen=avail.find(p=>p.pos==='K');
      else {
        const pN=(pos)=>pos==='RB'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.RB)):pos==='WR'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.WR)):0;
        chosen=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K'&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2))
          .map(p=>({p,s:p.mvor*(1+pN(p.pos)*0.35)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
      }
    }
    if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
  }
  const ts={};for(let t=0;t<NT;t++)ts[t]=score(picks.filter(p=>p.teamId===t));
  return ts;
}

function bench(label, opts, N=600) {
  const fn=makeScorer(opts);
  let total=0;
  for(let sim=0;sim<N;sim++){
    const rand=rng(sim*7919+1234),myTeamId=sim%NT;
    const ts=runDraft(myTeamId,fn,rand);
    const avg=Object.values(ts).reduce((s,v)=>s+v,0)/NT;
    total+=ts[myTeamId]-avg;
  }
  const avg=total/N;
  console.log(`  ${label.padEnd(45)}  ${avg>=0?'+':''}${avg.toFixed(1).padStart(7)} pts`);
  return avg;
}

console.log('\n── cap=0.3 investigation (600 sims each) ──\n');
console.log('  (positive = beats average; current simplified iackScore is the baseline)\n');

bench('current: depth+steal, cap=0.8, +mVOR clamp',  {depth:true, cliff:false, run:false, steal:true, capMult:0.8, positiveMVOR:true});
bench('depth+steal, cap=0.3, +mVOR clamp',            {depth:true, cliff:false, run:false, steal:true, capMult:0.3, positiveMVOR:true});
bench('depth+steal, cap=0.5, +mVOR clamp',            {depth:true, cliff:false, run:false, steal:true, capMult:0.5, positiveMVOR:true});
bench('depth only, cap=0.3, +mVOR clamp',             {depth:true, cliff:false, run:false, steal:false,capMult:0.3, positiveMVOR:true});
bench('all signals, cap=0.3, +mVOR clamp',            {depth:true, cliff:true,  run:true,  steal:true, capMult:0.3, positiveMVOR:true});
bench('all signals, cap=0.3, no +mVOR clamp',         {depth:true, cliff:true,  run:true,  steal:true, capMult:0.3, positiveMVOR:false});
bench('depth+cliff+steal, cap=0.3, +mVOR clamp',      {depth:true, cliff:true,  run:false, steal:true, capMult:0.3, positiveMVOR:true});
bench('depth+cliff+steal, cap=0.5, +mVOR clamp',      {depth:true, cliff:true,  run:false, steal:true, capMult:0.5, positiveMVOR:true});
