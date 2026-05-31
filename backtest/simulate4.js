/**
 * Fast focused analysis — 500 sims each, real ADP data
 * Questions:
 * 1. Does the QB/TE needMult specifically hurt? (key suspect from sim3)
 * 2. Which urgency signals help vs hurt?
 * 3. What's the optimal urgency weight combo?
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

const raw = fs.readFileSync(__dirname + '/../adp_rankings.csv', 'utf8');
const RAW = parseCSV(raw).map(p=>({...p, tier:tier(p.pos,p.posRank), projPts:proj(p.pos,p.posRank)}));

const NT=10, NR=16, ST={RB:2,WR:2,QB:1,TE:1}, BR={RB:0.28,WR:0.33,QB:0.11,TE:0.11};
function rng(s){let x=s;return()=>{x=(x*16807)%2147483647;return(x-1)/2147483646;};}
function dOrder(n,r){const o=[];for(let i=1;i<=r;i++){const row=Array.from({length:n},(_,j)=>j);if(i%2===0)row.reverse();row.forEach(t=>o.push({teamId:t,round:i,playerName:null}));}return o;}
function cnt(pk,tid,pos){return pk.filter(p=>p.teamId===tid&&p.pos===pos).length;}
function mvor(pool){
  const r={};
  ['RB','WR','QB','TE'].forEach(pos=>{const s=pool.filter(p=>p.pos===pos).sort((a,b)=>b.projPts-a.projPts);r[pos]=(s[NT*(ST[pos]||1)]||s[s.length-1]||{projPts:0}).projPts;});
  pool.forEach(p=>{p.mvor=(p.projPts||0)-(r[p.pos]||0);});
}
function score(tp){
  const bp={};tp.forEach(p=>{if(!bp[p.pos])bp[p.pos]=[];bp[p.pos].push(p);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>b.projPts-a.projPts));
  let t=(bp.QB?.[0]?.projPts||0)+(bp.RB?.[0]?.projPts||0)+(bp.RB?.[1]?.projPts||0)+(bp.WR?.[0]?.projPts||0)+(bp.WR?.[1]?.projPts||0)+(bp.TE?.[0]?.projPts||0);
  const fc=[bp.RB?.[2],bp.WR?.[2],bp.TE?.[1]].filter(Boolean).sort((a,b)=>b.projPts-a.projPts);
  return t+(fc[0]?.projPts||0);
}

function buildSignals(p, picks, draftOrder, curIdx, myTeamId, round, poolAvail) {
  const lateR = picks.filter(x=>x.teamId===myTeamId).length>=13;
  const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'RB'));
  const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-cnt(picks,myTeamId,'WR'));
  const qN=(!lateR&&cnt(picks,myTeamId,'QB')<1&&round>=6)?1:0;
  const tN=(!lateR&&cnt(picks,myTeamId,'TE')<1&&round>=5)?1:0;
  const nw={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
  const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
  const needMult=1+pn*(nw[p.pos]||0.25);
  const needMultRBWR=1+(p.pos==='RB'?rN:p.pos==='WR'?wN:0)*0.35;
  const bp={};poolAvail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
  const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
  const cliff=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
  const el=poolAvail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  const depth=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
  const rec=picks.slice(-10),rp={RB:0,WR:0,QB:0,TE:0};
  rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
  const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
  const ov=(rp[p.pos]||0)-(re[p.pos]||0);
  const run=Math.min((ov>=2?5:ov>=1?3:0)/5,1.0);
  const ot=Array.from({length:NT},(_,i)=>i).filter(i=>i!==myTeamId);
  const ld=ot.length?ot.filter(t=>cnt(picks,t,p.pos)<(ST[p.pos]||1)).length/ot.length:0;
  let ut=0,pc=0;
  for(let i=curIdx;i<draftOrder.length;i++){
    const sl=draftOrder[i];if(sl.teamId===myTeamId)break;if(sl.playerName)continue;pc++;
    const tn={},tt={total:0};
    ['RB','WR','QB','TE'].forEach(pos=>{tn[pos]=Math.max(0,(ST[pos]||1)-cnt(picks,sl.teamId,pos));tt.total+=tn[pos];});
    ut+=tt.total>0?(tn[p.pos]||0)/tt.total:(BR[p.pos]||0);
  }
  ut=pc>0?ut/pc:0;
  const dem=ut*0.65+ld*0.35;
  const prob=poolAvail.filter(x=>x.adpNoise<p.adpNoise).length;
  const ov2=(poolAvail.length-curIdx)-prob;
  const goneProb=Math.max(0.01,Math.min(0.99,1/(1+Math.exp(ov2/4))));
  const ecrGap=p.adp<500?Math.max(0,p.adpNoise-p.ecr):0;
  const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
  const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;
  return {needMult, needMultRBWR, cliff, depth, run, dem, steal, mvor:p.mvor};
}

function makeScorer(opts) {
  // opts: {needAll, cliff, depth, run, demand, steal, capMult, positiveMVOR}
  return function(p, state) {
    const {picks, draftOrder, curIdx, myTeamId, round} = state;
    const avail = state.pool.filter(x=>!x.drafted);
    const s = buildSignals(p, picks, draftOrder, curIdx, myTeamId, round, avail);
    const nm = opts.needAll ? s.needMult : s.needMultRBWR;
    const baseValue = opts.positiveMVOR
      ? Math.max(s.mvor, 0) * nm + Math.min(s.mvor, 0)
      : s.mvor * nm;
    const rawU = (opts.cliff?s.cliff:0)*0.30 + (opts.depth?s.depth:0)*0.22 + (opts.run?s.run:0)*0.13 + (opts.demand?s.dem:0)*0.35;
    const cap = opts.capMult != null ? opts.capMult : 0.8;
    return baseValue + rawU * Math.abs(s.mvor) * cap + (opts.steal ? s.steal : 0);
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
      const state={pool,picks,draftOrder:DO,curIdx:si,myTeamId,round};
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

function bench(label, opts, N=500) {
  let total=0;
  const fn=makeScorer(opts);
  for(let sim=0;sim<N;sim++){
    const rand=rng(sim*7919+1234),myTeamId=sim%NT;
    const ts=runDraft(myTeamId,fn,rand);
    const avg=Object.values(ts).reduce((s,v)=>s+v,0)/NT;
    total+=ts[myTeamId]-avg;
  }
  const avg=total/N;
  const prefix=avg>=0?'+':'';
  console.log(`  ${label.padEnd(38)}  ${prefix}${avg.toFixed(1).padStart(7)} pts`);
  return avg;
}

console.log('\n── Ablation: which components actually help? (500 sims each) ──\n');
console.log('  (baseline = full iackScore)\n');

const baseline = bench('full iackScore (current)',        {needAll:true, cliff:true,  depth:true,  run:true,  demand:true,  steal:true,  capMult:0.8});
bench(              'remove QB/TE needMult',              {needAll:false,cliff:true,  depth:true,  run:true,  demand:true,  steal:true,  capMult:0.8});
bench(              'remove steal bonus',                 {needAll:true, cliff:true,  depth:true,  run:true,  demand:true,  steal:false, capMult:0.8});
bench(              'remove demand signal',               {needAll:true, cliff:true,  depth:true,  run:true,  demand:false, steal:true,  capMult:0.8});
bench(              'remove cliff signal',                {needAll:true, cliff:false, depth:true,  run:true,  demand:true,  steal:true,  capMult:0.8});
bench(              'remove depth signal',                {needAll:true, cliff:true,  depth:false, run:true,  demand:true,  steal:true,  capMult:0.8});
bench(              'remove run signal',                  {needAll:true, cliff:true,  depth:true,  run:false, demand:true,  steal:true,  capMult:0.8});
bench(              'remove ALL urgency (mVOR*need only)',{needAll:true, cliff:false, depth:false, run:false, demand:false, steal:false, capMult:0.0});
bench(              'mVOR * RB/WR need only (simplest)',  {needAll:false,cliff:false, depth:false, run:false, demand:false, steal:false, capMult:0.0});

console.log('\n── Cap multiplier scan (remove QB/TE need, keep all signals) ──\n');
for(const cap of [0.0, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0]) {
  bench(`capMult=${cap} (no QB/TE need)`, {needAll:false,cliff:true,depth:true,run:true,demand:true,steal:true,capMult:cap});
}

console.log('\n── Best combo: run-only urgency variants ──\n');
bench('run only, no QB/TE need, cap=0.8',   {needAll:false,cliff:false,depth:false,run:true, demand:false,steal:false,capMult:0.8});
bench('run+cliff, no QB/TE need, cap=0.8',  {needAll:false,cliff:true, depth:false,run:true, demand:false,steal:false,capMult:0.8});
bench('run+cliff+depth, no QB/TE, cap=0.8', {needAll:false,cliff:true, depth:true, run:true, demand:false,steal:false,capMult:0.8});
bench('run+cliff, steal, no QB/TE, cap=0.8',{needAll:false,cliff:true, depth:false,run:true, demand:false,steal:true, capMult:0.8});
bench('run+cliff+depth+steal, no QB/TE',    {needAll:false,cliff:true, depth:true, run:true, demand:false,steal:true, capMult:0.8});

console.log('\n── positiveMVOR clamp + cap investigation ──\n');
bench('depth+steal, cap=0.8, no +mVOR (baseline)',    {needAll:false,cliff:false,depth:true,run:false,demand:false,steal:true,capMult:0.8,positiveMVOR:false});
bench('depth+steal, cap=0.8, +mVOR (current actual)', {needAll:false,cliff:false,depth:true,run:false,demand:false,steal:true,capMult:0.8,positiveMVOR:true});
bench('depth+steal, cap=0.3, +mVOR',                  {needAll:false,cliff:false,depth:true,run:false,demand:false,steal:true,capMult:0.3,positiveMVOR:true});
bench('depth+steal, cap=0.5, +mVOR',                  {needAll:false,cliff:false,depth:true,run:false,demand:false,steal:true,capMult:0.5,positiveMVOR:true});
bench('depth+cliff+steal, cap=0.3, +mVOR',            {needAll:false,cliff:true, depth:true,run:false,demand:false,steal:true,capMult:0.3,positiveMVOR:true});
bench('depth+cliff+steal, cap=0.3, no +mVOR',         {needAll:false,cliff:true, depth:true,run:false,demand:false,steal:true,capMult:0.3,positiveMVOR:false});
bench('all signals, cap=0.3, +mVOR',                  {needAll:false,cliff:true, depth:true,run:true, demand:true, steal:true,capMult:0.3,positiveMVOR:true});
bench('all signals, cap=0.3, no +mVOR',               {needAll:false,cliff:true, depth:true,run:true, demand:true, steal:true,capMult:0.3,positiveMVOR:false});
