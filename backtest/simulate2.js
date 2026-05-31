/**
 * Deeper analysis:
 * 1. Does iackScore actually beat "pure mVOR" or "pure ADP" strategies?
 * 2. Which urgency signals actually prevent regret (player taken before next turn)?
 * 3. What's the optimal urgency cap multiplier?
 */

// ── Reuse pool/helpers from simulate.js ─────────────────────────────────────
const POOL = [
  ['Christian McCaffrey','RB',1,1,1,380],['Bijan Robinson','RB',2,2,1,355],
  ['Breece Hall','RB',4,3,1,345],['Jahmyr Gibbs','RB',5,5,1,335],
  ['De\'Von Achane','RB',6,4,1,340],['Jonathan Taylor','RB',8,7,1,310],
  ['CeeDee Lamb','WR',3,3,1,370],['Ja\'Marr Chase','WR',7,6,1,350],
  ['Justin Jefferson','WR',9,8,1,340],['Tyreek Hill','WR',12,10,1,310],
  ['Tony Pollard','RB',10,9,2,285],['Saquon Barkley','RB',11,11,2,290],
  ['Josh Jacobs','RB',14,13,2,275],['Travis Etienne','RB',15,14,2,270],
  ['Rhamondre Stevenson','RB',18,16,2,260],['David Montgomery','RB',20,18,2,255],
  ['Derrick Henry','RB',22,21,2,250],['Aaron Jones','RB',24,23,2,245],
  ['Amon-Ra St. Brown','WR',13,12,2,310],['Stefon Diggs','WR',16,15,2,295],
  ['Davante Adams','WR',17,17,2,300],['A.J. Brown','WR',19,19,2,295],
  ['Cooper Kupp','WR',21,20,2,285],['DK Metcalf','WR',23,22,2,280],
  ['Puka Nacua','WR',25,24,2,275],['Deebo Samuel','WR',27,26,2,265],
  ['Sam LaPorta','TE',26,25,1,220],['Travis Kelce','TE',28,28,1,230],
  ['Mark Andrews','TE',30,29,1,215],['Dallas Goedert','TE',33,31,1,205],
  ['Josh Allen','QB',29,27,1,400],['Lamar Jackson','QB',32,30,1,395],
  ['Patrick Mahomes','QB',35,33,1,385],
  ['Zach Charbonnet','RB',34,34,3,220],['Isiah Pacheco','RB',36,36,3,215],
  ['Brian Robinson','RB',38,37,3,210],['Rachaad White','RB',40,39,3,205],
  ['Kyren Williams','RB',42,41,3,200],['Miles Sanders','RB',44,43,3,195],
  ['Dameon Pierce','RB',46,45,3,190],['Tyler Allgeier','RB',48,47,3,185],
  ['Javonte Williams','RB',50,49,3,180],['James Conner','RB',52,51,3,175],
  ['Najee Harris','RB',54,53,3,170],['Tyjae Spears','RB',56,55,3,165],
  ['Clyde Edwards-Helaire','RB',58,57,3,160],['Khalil Herbert','RB',60,59,3,155],
  ['AJ Dillon','RB',62,61,3,150],['Jamaal Williams','RB',64,63,3,145],
  ['D\'Andre Swift','RB',66,65,3,140],['Elijah Mitchell','RB',68,67,3,135],
  ['Keenan Allen','WR',31,32,3,255],['Chris Olave','WR',37,35,3,250],
  ['Tee Higgins','WR',39,38,3,245],['Michael Pittman','WR',41,40,3,240],
  ['Garrett Wilson','WR',43,42,3,235],['Jordan Addison','WR',45,44,3,230],
  ['Jaylen Waddle','WR',47,46,3,225],['Zay Flowers','WR',49,48,3,220],
  ['Christian Kirk','WR',51,50,3,215],['Marquise Brown','WR',53,52,3,210],
  ['Courtland Sutton','WR',55,54,3,205],['George Pickens','WR',57,56,3,200],
  ['Diontae Johnson','WR',59,58,3,195],['Adam Thielen','WR',61,60,3,185],
  ['Tyler Lockett','WR',63,62,3,180],['Drake London','WR',65,64,3,175],
  ['Rashee Rice','WR',67,66,3,170],['Quentin Johnston','WR',69,68,3,165],
  ['Kyle Pitts','TE',70,70,2,185],['Trey McBride','TE',72,71,2,180],
  ['Evan Engram','TE',74,73,2,175],['Jake Ferguson','TE',76,75,2,170],
  ['Pat Freiermuth','TE',78,77,2,165],['Cole Kmet','TE',80,79,2,160],
  ['Dalton Kincaid','TE',82,81,2,155],['T.J. Hockenson','TE',84,83,2,150],
  ['Jalen Hurts','QB',71,69,2,370],['Joe Burrow','QB',73,72,2,355],
  ['Dak Prescott','QB',75,74,2,345],['Justin Herbert','QB',77,76,2,340],
  ['Tua Tagovailoa','QB',79,78,2,335],['Jared Goff','QB',81,80,2,320],
  ['Trevor Lawrence','QB',83,82,2,315],['Anthony Richardson','QB',85,84,2,310],
  ['Rashid Shaheed','WR',86,86,4,140],['Odell Beckham Jr.','WR',88,87,4,135],
  ['Darnell Mooney','WR',90,89,4,130],['Wan\'Dale Robinson','WR',92,91,4,125],
  ['Romeo Doubs','WR',94,93,4,120],['Jaxon Smith-Njigba','WR',96,95,4,120],
  ['Elijah Moore','WR',98,97,4,115],['Brandin Cooks','WR',100,99,4,110],
  ['Boston Scott','RB',87,88,4,110],['Damien Harris','RB',89,90,4,105],
  ['Latavius Murray','RB',91,92,4,100],['Tony Jones Jr.','RB',93,94,4,95],
  ['Matt Breida','RB',95,96,4,90],['Marlon Mack','RB',97,98,4,85],
  ['Cam Akers','RB',99,100,4,80],['Craig Reynolds','RB',101,102,4,78],
  ['Will Dissly','TE',110,109,3,120],['Noah Fant','TE',112,111,3,115],
  ['Foster Moreau','TE',114,113,3,110],['Gerald Everett','TE',116,115,3,105],
  ['Hayden Hurst','TE',118,117,3,100],['Juwan Johnson','TE',120,119,3,95],
  ['Derek Carr','QB',111,112,3,290],['Ryan Tannehill','QB',113,114,3,280],
  ['Kirk Cousins','QB',115,116,3,275],['Geno Smith','QB',117,118,3,270],
  ['Jordan Love','QB',119,120,3,265],['Sam Howell','QB',121,122,3,260],
  ['Deon Jackson','RB',126,127,5,60],['Tyrion Davis-Price','RB',128,129,5,55],
  ['Dare Ogunbowale','RB',130,131,5,50],['Ronnie Rivers','RB',132,133,5,48],
  ['Marquez Callaway','WR',127,128,5,65],['Anthony Miller','WR',129,130,5,62],
  ['Parris Campbell','WR',131,132,5,60],['Velus Jones Jr.','WR',133,134,5,58],
  ['Irv Smith Jr.','TE',142,143,5,70],['Tyler Conklin','TE',144,145,5,65],
  ['DST1','DST',143,144,4,120],['DST2','DST',150,150,4,115],
  ['K1','K',155,155,4,140],['K2','K',160,160,4,135],
];

const NUM_TEAMS=10, NUM_ROUNDS=16, N_SIMS=3000;
const STARTER_THRESHOLD={RB:2,WR:2,QB:1,TE:1};
const BASE_RATES={RB:0.28,WR:0.33,QB:0.11,TE:0.11};

function rng(seed) {
  let s=seed;
  return ()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};
}
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
  if(!p.adpNoise||p.adpNoise>=200)return null;
  const rem=avail.filter(x=>x.adpNoise<p.adpNoise).length;
  const ov=(avail.length-curIdx%NUM_TEAMS)-rem;
  return Math.max(0.01,Math.min(0.99,1/(1+Math.exp(ov/4))));
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

// ── Strategy definitions ───────────────────────────────────────────────────
// Each strategy picks the best available player according to its scoring fn

function strategyPureVOR(p) {
  return p.mvor;
}

function strategyPureADP(p) {
  return -p.adpNoise;  // pick lowest ADP (best available by consensus)
}

function strategyIackScore(p, state) {
  const {picks, draftOrder, curIdx, myTeamId, round} = state;
  const avail = state.pool.filter(x => !x.drafted);
  const prob = pickProb(p, curIdx, avail);
  const goneProb = prob ? 1-prob : 0.1;

  // needMult
  const lateR = picks.filter(x=>x.teamId===myTeamId).length>=13;
  const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
  const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
  const qN=(!lateR&&tpc(picks,myTeamId,'QB')<1&&round>=6)?1:0;
  const tN=(!lateR&&tpc(picks,myTeamId,'TE')<1&&round>=5)?1:0;
  const nw={RB:0.35,WR:0.35,QB:0.20,TE:0.18};
  const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:p.pos==='QB'?qN:p.pos==='TE'?tN:0;
  const needMult=1+pn*(nw[p.pos]||0.25);
  const baseValue=p.mvor*needMult;

  // steal
  const ecrGap=p.adp<200?Math.max(0,p.adpNoise-p.ecr):0;
  const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
  const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;

  // urgency signals
  const bp={};
  avail.forEach(x=>{if(!bp[x.pos])bp[x.pos]=[];bp[x.pos].push(x);});
  Object.values(bp).forEach(a=>a.sort((a,b)=>a.adpNoise-b.adpNoise));
  const nap=(bp[p.pos]||[]).find(x=>x.name!==p.name);
  const cliff=(nap&&p.tier!=null&&nap.tier!=null&&nap.tier>p.tier)?1.0:0.0;
  const el=avail.filter(x=>x.pos===p.pos&&x.tier<=3).length;
  const depth=(p.tier!=null&&p.tier<=3)?(el<=2?1.0:el<=4?0.6:el<=6?0.3:0.0):0.0;
  const rec=picks.slice(-10);
  const rp={RB:0,WR:0,QB:0,TE:0};
  rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
  const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
  const ov=(rp[p.pos]||0)-(re[p.pos]||0);
  const run=Math.min((ov>=2?5:ov>=1?3:0)/5,1.0);
  // demand
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
  const urgency=rawU*Math.abs(p.mvor)*0.8;
  return baseValue+urgency+steal;
}

// ── Draft simulator ─────────────────────────────────────────────────────────
function runDraft(myTeamId, stratFn, rand) {
  const pool = POOL.map(([name,pos,adp,ecr,tier,projPts])=>({
    name,pos,adp,ecr,tier,projPts,
    adpNoise:adp*(0.85+rand()*0.30),drafted:false,mvor:0
  }));
  computeMVOR(pool);
  const draftOrder = buildDraftOrder(NUM_TEAMS, NUM_ROUNDS);
  const picks = [];

  for(let si=0;si<draftOrder.length;si++){
    const slot=draftOrder[si];
    const round=slot.round;
    const avail=pool.filter(p=>!p.drafted);
    const isMe=slot.teamId===myTeamId;
    let chosen;

    if(isMe){
      const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K');
      const state={pool,picks,draftOrder,curIdx:si,myTeamId,round};
      const scored=cands.map(p=>({p,s:stratFn(p,state)})).sort((a,b)=>b.s-a.s);
      chosen=scored[0]?.p;
    } else {
      // Opponents: pure mVOR with basic position caps
      const have={};
      ['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=tpc(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      if(!lateR&&have['DST']===0&&round>=14){chosen=avail.find(p=>p.pos==='DST');}
      else if(!lateR&&have['K']===0&&round>=15){chosen=avail.find(p=>p.pos==='K');}
      else {
        const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K');
        const sc=cands.map(p=>{
          if(have['QB']>=2&&p.pos==='QB')return{p,s:-999};
          if(have['TE']>=2&&p.pos==='TE')return{p,s:-999};
          const pN=p.pos==='RB'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have['RB'])):
                   p.pos==='WR'?(lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-have['WR'])):0;
          const nw={RB:0.35,WR:0.35}[p.pos]||0;
          return{p,s:p.mvor*(1+pN*nw)};
        }).sort((a,b)=>b.s-a.s);
        chosen=sc[0]?.p;
      }
    }
    if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
  }

  const teamScores={};
  for(let t=0;t<NUM_TEAMS;t++) teamScores[t]=scoreRoster(picks.filter(p=>p.teamId===t));
  return teamScores;
}

// ── Compare strategies ─────────────────────────────────────────────────────
const strategies = [
  ['Pure ADP',   (p,state) => strategyPureADP(p)],
  ['Pure mVOR',  (p,state) => strategyPureVOR(p)],
  ['iackScore',  (p,state) => strategyIackScore(p,state)],
  ['mVOR+run',   (p,state) => { // mVOR + run signal only (test if run alone beats full model)
    const picks=state.picks;
    const rec=picks.slice(-10),rp={RB:0,WR:0,QB:0,TE:0};
    rec.forEach(x=>{if(rp[x.pos]!==undefined)rp[x.pos]++;});
    const re={RB:2.8,WR:3.3,QB:1.1,TE:1.1};
    const ov=(rp[p.pos]||0)-(re[p.pos]||0);
    const run=ov>=2?0.4:ov>=1?0.24:0;
    return p.mvor*(1+run);
  }],
  ['mVOR+need',  (p,state) => { // mVOR + need only
    const {picks,myTeamId,round}=state;
    const lateR=picks.filter(x=>x.teamId===myTeamId).length>=13;
    const rN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'RB'));
    const wN=lateR?0:Math.max(0,Math.min(Math.floor(round/2.5),3)-tpc(picks,myTeamId,'WR'));
    const pn=p.pos==='RB'?rN:p.pos==='WR'?wN:0;
    return p.mvor*(1+pn*0.35);
  }],
];

const results={};
strategies.forEach(([name])=>{results[name]={wins:0,totalDelta:0,count:0};});

for(let sim=0;sim<N_SIMS;sim++){
  const rand=rng(sim*7919+1234);
  const myTeamId=sim%NUM_TEAMS;
  const simResults={};
  strategies.forEach(([name,fn])=>{
    // Each strategy drafts from the same seed
    const r2=rng(sim*7919+1234);
    const scores=runDraft(myTeamId,fn,r2);
    const avg=Object.values(scores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
    simResults[name]=scores[myTeamId]-avg;
  });

  strategies.forEach(([name])=>{
    results[name].totalDelta+=simResults[name];
    results[name].count++;
  });

  // Win = beats iackScore? compare pairwise vs iackScore
  strategies.forEach(([name])=>{
    if(name!=='iackScore'&&simResults[name]>simResults['iackScore']) results[name].wins++;
    if(name==='iackScore') {/* baseline */}
  });
}

console.log('\n── Strategy comparison (avg pts vs league average) ──\n');
strategies.forEach(([name])=>{
  const r=results[name];
  const avg=(r.totalDelta/r.count).toFixed(1);
  const bar=(avg>0?'█':'░').repeat(Math.min(Math.abs(parseFloat(avg)/2),30));
  const prefix=parseFloat(avg)>=0?'+':'';
  console.log(`  ${name.padEnd(14)} ${prefix}${avg} pts avg   ${bar}`);
});

console.log('\n── Regret analysis: how often does iackScore fail to grab a player ──');
console.log('   (player was top-3 iackScore but taken before next turn)\n');

// Run a focused regret simulation
let totalPicks=0, regretCount=0, regretBySignal={cliff:0,depth:0,run:0,demand:0,none:0};
for(let sim=0;sim<1000;sim++){
  const rand=rng(sim*3571+999);
  const myTeamId=sim%NUM_TEAMS;
  const pool=POOL.map(([name,pos,adp,ecr,tier,projPts])=>({
    name,pos,adp,ecr,tier,projPts,adpNoise:adp*(0.85+rand()*0.30),drafted:false,mvor:0
  }));
  computeMVOR(pool);
  const draftOrder=buildDraftOrder(NUM_TEAMS,NUM_ROUNDS);
  const picks=[];

  for(let si=0;si<draftOrder.length;si++){
    const slot=draftOrder[si];
    const round=slot.round;
    const avail=pool.filter(p=>!p.drafted);
    const isMe=slot.teamId===myTeamId;

    if(isMe){
      const cands=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K');
      const state={pool,picks,draftOrder,curIdx:si,myTeamId,round};

      // Score top 5 candidates with iackScore
      const scored=cands.map(p=>({p,s:strategyIackScore(p,state)})).sort((a,b)=>b.s-a.s);
      const top3=scored.slice(0,3).map(x=>x.p.name);

      // Check if any top3 from PREVIOUS turn were taken (regret)
      // Already handled by drafted flag, so look forward instead:
      // Record top3 at this pick, check after opponents pick before next turn
      const nextMyPick=draftOrder.slice(si+1).find(s=>s.teamId===myTeamId);

      const chosen=scored[0]?.p;
      if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}

      // After my pick: what were the runners-up that might get taken?
      const runnersUp=scored.slice(1,4).map(x=>x.p);
      // Simulate forward to next pick to check regret
      // (skip - just track signal presence at time of pick)
      totalPicks++;
      // Was cliff/depth/run/demand active for the top pick?
      const sig=scored[0]?.s;
    } else {
      const have={};
      ['RB','WR','QB','TE','DST','K'].forEach(pos=>{have[pos]=tpc(picks,slot.teamId,pos);});
      const lateR=picks.filter(p=>p.teamId===slot.teamId).length>=13;
      let chosen;
      if(!lateR&&have['DST']===0&&round>=14){chosen=avail.find(p=>p.pos==='DST');}
      else if(!lateR&&have['K']===0&&round>=15){chosen=avail.find(p=>p.pos==='K');}
      else{
        const sc=avail.filter(p=>p.pos!=='DST'&&p.pos!=='K').map(p=>{
          if(have['QB']>=2&&p.pos==='QB')return{p,s:-999};
          if(have['TE']>=2&&p.pos==='TE')return{p,s:-999};
          return{p,s:p.mvor};
        }).sort((a,b)=>b.s-a.s);
        chosen=sc[0]?.p;
      }
      if(chosen){chosen.drafted=true;slot.playerName=chosen.name;picks.push({teamId:slot.teamId,pos:chosen.pos,projPts:chosen.projPts,name:chosen.name});}
    }
  }
}

// ── Optimal urgency cap multiplier scan ──────────────────────────────────────
console.log('\n── Optimal urgency cap multiplier ──');
console.log('   (scanning |mVOR| * X, measuring strategy avg outcome)\n');

[0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0].forEach(capMult => {
  const stratFn = (p, state) => {
    const {picks,draftOrder,curIdx,myTeamId,round}=state;
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
    const ecrGap=p.adp<200?Math.max(0,p.adpNoise-p.ecr):0;
    const sw=(p.pos==='QB'||p.pos==='TE')?0.4:1.0;
    const steal=Math.min(ecrGap/5,4)*Math.max(goneProb,0.1)*sw;
    return p.mvor*needMult + rawU*Math.abs(p.mvor)*capMult + steal;
  };

  let totalDelta=0, count=0;
  for(let sim=0;sim<500;sim++){
    const rand=rng(sim*7919+1234);
    const myTeamId=sim%NUM_TEAMS;
    const scores=runDraft(myTeamId,stratFn,rand);
    const avg=Object.values(scores).reduce((s,v)=>s+v,0)/NUM_TEAMS;
    totalDelta+=scores[myTeamId]-avg;
    count++;
  }
  const avg=(totalDelta/count).toFixed(1);
  const prefix=parseFloat(avg)>=0?'+':'';
  console.log(`  capMult=${capMult.toFixed(1)}  avg delta=${prefix}${avg} pts`);
});
