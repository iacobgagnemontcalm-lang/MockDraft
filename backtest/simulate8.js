// needMult weight scan — uses proven simulate4/7 infrastructure, new scorer only
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
function tier(pos,r){const t={QB:[3,8,18],RB:[8,20,40],WR:[8,20,40],TE:[4,10,20]}[pos]||[8,20,40];return r<=t[0]?1:r<=t[1]?2:r<=t[2]?3:4;}
function proj(pos,r){const c={QB:{b:450,d:0.970,f:120},RB:{b:380,d:0.935,f:40},WR:{b:370,d:0.940,f:40},TE:{b:250,d:0.910,f:30}}[pos]||{b:370,d:0.940,f:40};return Math.max(c.f,Math.round(c.b*Math.pow(c.d,r-1)));}
const raw = fs.readFileSync(__dirname + '/../adp_rankings.csv', 'utf8');
const RAW = parseCSV(raw).map(p=>({...p,tier:tier(p.pos,p.posRank),projPts:proj(p.pos,p.posRank)}));

const NT=10,NR=16,ST={RB:2,WR:2,QB:1,TE:1},BR={RB:0.28,WR:0.33,QB:0.11,TE:0.11};
function rng(s){let x=s;return()=>{x=(x*16807)%2147483647;return(x-1)/2147483646;};}
function dOrder(n,r){const o=[];for(let i=1;i<=r;i++){const row=Array.from({length:n},(_,j)=>j);if(i%2===0)row.reverse();row.forEach(t=>o.push({teamId:t,round:i,playerName:null}));}return o;}
function cnt(pk,tid,pos){return pk.filter(p=>p.teamId===tid&&p.pos===pos).length;}
function mvorCalc(pool){const r={};['RB','WR','QB','TE'].forEach(pos=>{const s=pool.filter(p=>p.pos===pos).sort((a,b)=>b.projPts-a.projPts);r[pos]=(s[NT*(ST[pos]||1)]||s[s.length-1]||{projPts:0}).projPts;});pool.forEach(p=>{p.mvor=(p.projPts||0)-(r[p.pos]||0);});}
function score(tp){const bp={};tp.forEach(p=>{if(!bp[p.pos])bp[p.pos]=[];bp[p.pos].push(p);});Object.values(bp).forEach(a=>a.sort((a,b)=>b.projPts-a.projPts));let t=(bp.QB?.[0]?.projPts||0)+(bp.RB?.[0]?.projPts||0)+(bp.RB?.[1]?.projPts||0)+(bp.WR?.[0]?.projPts||0)+(bp.WR?.[1]?.projPts||0)+(bp.TE?.[0]?.projPts||0);const fc=[bp.RB?.[2],bp.WR?.[2],bp.TE?.[1]].filter(Boolean).sort((a,b)=>b.projPts-a.projPts);return t+(fc[0]?.projPts||0);}

function buildSignals(p,picks,draftOrder,curIdx,myTeamId,round,poolAvail){
  const bp={};poolAvail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
  const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
  const cliff=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
  const el=poolAvail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  const depth=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
  const ov2=(poolAvail.length-curIdx)-poolAvail.filter(x=>x.adpNoise<p.adpNoise).length;
  const goneProb=Math.max(0.01,Math.min(0.99,1/(1+Math.exp(ov2/4))));
  const ecrGap=p.adp<500?Math.max(0,p.adpNoise-p.ecr):0;
  const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
  const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;
  return {cliff,depth,steal,mvor:p.mvor};
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
      const cands=avail.filter(p=>!['DST','K'].includes(p.pos)&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2));
      const state={pool,picks,draftOrder:DO,curIdx:si,myTeamId,round};
      chosen=cands.map(p=>({p,s:scorerFn(p,state)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
    } else {
      const have={};['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=cnt(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      if(!lateR&&have.DST===0&&round>=14) chosen=avail.find(p=>p.pos==='DST');
      else if(!lateR&&have.K===0&&round>=15) chosen=avail.find(p=>p.pos==='K');
      else {
        const pN=(pos)=>pos==='RB'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.RB)):pos==='WR'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have.WR)):0;
        chosen=avail.filter(p=>!['DST','K'].includes(p.pos)&&!(p.pos==='QB'&&have.QB>=2)&&!(p.pos==='TE'&&have.TE>=2))
          .map(p=>({p,s:p.mvor*(1+pN(p.pos)*0.35)})).sort((a,b)=>b.s-a.s)[0]?.p||avail[0];
      }
    }
    if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
  }
  const ts={};for(let t=0;t<NT;t++)ts[t]=score(picks.filter(p=>p.teamId===t));
  return ts;
}

function benchNeed(w, N=500) {
  const fn = function(p, state) {
    const {picks, draftOrder, curIdx, myTeamId, round} = state;
    const avail = state.pool.filter(x=>!x.drafted);
    const s = buildSignals(p, picks, draftOrder, curIdx, myTeamId, round, avail);
    const lateR = picks.filter(x=>x.teamId===myTeamId).length >= 13;
    const rbNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - cnt(picks,myTeamId,'RB'));
    const wrNeed = lateR ? 0 : Math.max(0, Math.min(Math.floor(round/2.5),3) - cnt(picks,myTeamId,'WR'));
    const nm = 1 + (p.pos==='RB' ? rbNeed : p.pos==='WR' ? wrNeed : 0) * w;
    const baseValue = Math.max(s.mvor,0)*nm + Math.min(s.mvor,0);
    const urgencyBoost = (s.cliff*0.30 + s.depth*0.22) * Math.abs(s.mvor) * 0.3;
    return baseValue + urgencyBoost + s.steal;
  };
  let total=0;
  for(let sim=0;sim<N;sim++){
    const rand=rng(sim*7919+1234),myTeamId=sim%NT;
    const ts=runDraft(myTeamId,fn,rand);
    const avg=Object.values(ts).reduce((s,v)=>s+v,0)/NT;
    total+=ts[myTeamId]-avg;
  }
  const avg=total/N;
  console.log((avg>=0?'+':'')+avg.toFixed(1).padStart(7)+' pts  needWeight='+w);
}

console.log('\n── needMult weight scan (depth+cliff+steal, cap=0.3, +mVOR, 500 sims) ──\n');
for(const w of [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50]) benchNeed(w);
