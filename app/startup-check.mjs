// Independent cold/warmed server-process pairs; all interrupted pairs are retained/excluded.
process.argv[2]='library';
const {guard,dc,monitored}=await import('./benchmark.mjs');
const fs=await import('node:fs');
const raw=new URL('../results/raw/',import.meta.url);
const read=n=>fs.existsSync(new URL(n,raw))?fs.readFileSync(new URL(n,raw),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const log=x=>fs.appendFileSync(new URL('startup-runs.jsonl',raw),JSON.stringify(x)+'\n');
const prior=read('startup-runs.jsonl');const done=new Set(prior.filter(x=>x.state==='warm').map(x=>x.base));
const cells=[];for(let seed=1;seed<=3;seed++)for(const mode of ['csr','ssr'])for(const fe of [false,true])for(const be of [false,true])cells.push({seed,mode,fe,be});
let state=20261021;function random(){state=(1664525*state+1013904223)>>>0;return state/4294967296;}
for(let i=cells.length-1;i>0;i--){let j=Math.floor(random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
const manifestPath=new URL('startup-manifest.json',raw);
if(fs.existsSync(manifestPath)){const p=JSON.parse(fs.readFileSync(manifestPath,'utf8'));if(JSON.stringify(p.cells)!==JSON.stringify(cells))throw Error('Startup manifest differs');}
else fs.writeFileSync(manifestPath,JSON.stringify({created:new Date().toISOString(),cells,orderSeed:20261021,delay:0,reps:3},null,2));
for(let i=0;i<cells.length;i++){
 const c=cells[i],base=`startup-s${c.seed}-${c.mode}-f${+c.fe}-b${+c.be}`;if(done.has(base))continue;
 const attempt=read('startup-failures.jsonl').filter(x=>x.base===base).length;
 const pair=attempt?base+'-retry'+attempt:base;const pairStart=new Date().toISOString();
 try{
  guard();dc('restart','web','api');dc('exec','-T','client','tc','qdisc','replace','dev','eth0','root','netem','delay','0ms');
  for(const [host,port] of [['web','3000'],['api','5001']])for(let t=0;;t++){
   try{await monitored(['exec','-T','client','node','tcp.mjs',host,port]);break;}
   catch(e){if(t===59||String(e).includes('Main harness active'))throw e;await new Promise(ok=>setTimeout(ok,500));}
  }
  for(const phase of ['cold','warm']){
   const run=pair+'-'+phase,start=new Date().toISOString();
   const out=await monitored(['exec','-T','client','node','runner.mjs',JSON.stringify({...c,run,pages:[100,101,100,101,102,101],phase:'startup-'+phase})]);
   log({...c,base,pair,run,start,end:new Date().toISOString(),versions:JSON.parse(out.trim()),state:phase});
  }
  console.log(`[${i+1}/${cells.length}] ${pair}`);
 }catch(e){fs.appendFileSync(new URL('startup-failures.jsonl',raw),JSON.stringify({...c,base,pair,start:pairStart,end:new Date().toISOString(),error:e.message})+'\n');throw e;}
}
