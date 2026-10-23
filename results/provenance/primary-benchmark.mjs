// Host orchestrator. All Docker mutations are restricted to project unibench.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync,spawn} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));process.chdir(root);
const raw=path.resolve(root,'../results/raw');fs.mkdirSync(raw,{recursive:true});
const event=x=>fs.appendFileSync(raw+'/batches.jsonl',JSON.stringify({at:new Date().toISOString(),...x})+'\n');
function guard(){try{const p=execFileSync('pgrep',['-f','harness.mjs'],{encoding:'utf8'}).trim();throw Error('Main harness active: '+p);}catch(e){if(e.status===1)return;throw e;}}
function dc(...a){return execFileSync('docker',['compose','-p','unibench','-f',root+'/docker-compose.yml',...a],{encoding:'utf8',maxBuffer:20e6});}
async function monitored(args){guard();event({event:'batch-start',args,pgrep:'empty'});
 const child=spawn('docker',['compose','-p','unibench','-f',root+'/docker-compose.yml',...args],{stdio:['ignore','pipe','pipe']});
 const wake=spawn('caffeinate',['-i','-s','-w',String(child.pid)],{stdio:'ignore'});let text='',err='',blocked=null;
 child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>err+=x);
 const poll=setInterval(()=>{try{guard();}catch(e){blocked=e.message;child.kill('SIGTERM');}},250);
 const code=await new Promise(ok=>child.on('exit',ok));clearInterval(poll);wake.kill();
 try{guard();}catch(e){blocked=e.message;}
 event({event:'batch-end',args,code,pgrep:blocked||'empty'});
 if(blocked||code!==0)throw Error(blocked||err||'docker command failed');return text;
}
function rand(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(a,random){for(let i=a.length-1;i>0;i--){let j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const command=process.argv[2]||'run';guard();
if(command==='build') {console.log(dc('build'));process.exit(0);}
if(command==='up'){console.log(dc('up','-d'));process.exit(0);}
function checkSql(){
 const sql=fs.readFileSync(root+'/backend/check.sql','utf8');
 const out=execFileSync('docker',['compose','-p','unibench','exec','-T','db','psql','-U','unibench','-d','unibench','-At'],{input:sql,encoding:'utf8'});
 fs.writeFileSync(raw+'/sql-check.txt',out);return out;
}
if(command==='check'){console.log(checkSql());process.exit(0);}
console.log(checkSql());
for(let i=0;i<120;i++){
 try{const r=await fetch('http://127.0.0.1:25001/health');if(r.ok)break;}catch{}
 if(i===119)throw Error('API readiness timeout');await new Promise(ok=>setTimeout(ok,500));
}
const reps=Number(process.env.UNI_REPS||(command==='smoke'?1:30));
const delays=command==='smoke'?[0]:[0,40,170];const prefix=command==='smoke'?'smoke':'primary';
const all=[];for(let seed=1;seed<=reps;seed++)for(const delay of delays)for(const mode of ['csr','ssr'])for(const fe of [false,true])for(const be of [false,true])all.push({seed,delay,mode,fe,be});
shuffle(all,rand(20261020));
fs.writeFileSync(raw+'/'+prefix+'-manifest.json',JSON.stringify({created:new Date().toISOString(),reps,delays,orderSeed:20261020,configs:all},null,2));
const completed=new Set(fs.existsSync(raw+'/runs.jsonl')?fs.readFileSync(raw+'/runs.jsonl','utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x).run):[]);
// Runtime/JIT warm-up on sacrificial run namespaces, with no primary keys populated.
console.log(dc('exec','-T','client','tc','qdisc','replace','dev','eth0','root','netem','delay','0ms'));
for(const mode of ['csr','ssr'])for(const fe of [false,true])for(const be of [false,true]){
 const c={run:`warm-${prefix}-${Date.now()}-${mode}-${+fe}-${+be}`,mode,fe,be,pages:[195,196,195,196,197,196],phase:'warmup'};
 await monitored(['exec','-T','client','node','runner.mjs',JSON.stringify(c)]);
}
for(let i=0;i<all.length;i++){
 const c=all[i],run=`${prefix}-s${c.seed}-d${c.delay}-${c.mode}-f${+c.fe}-b${+c.be}`;if(completed.has(run))continue;
 guard();console.log(dc('exec','-T','client','tc','qdisc','replace','dev','eth0','root','netem','delay',c.delay+'ms'));
 const tcp={};for(const [name,host,port] of [['client_web','web','3000'],['client_api','api','5001']])tcp[name]=JSON.parse(await monitored(['exec','-T','client','node','tcp.mjs',host,port]));
 const base=1+Math.floor(rand(c.seed)()*190),pages=[base,base+1,base,base+1,base+2,base+1];
 const start=new Date().toISOString();
 try{
 const versions=JSON.parse((await monitored(['exec','-T','client','node','runner.mjs',JSON.stringify({...c,run,pages,phase:prefix})])).trim());
 fs.appendFileSync(raw+'/runs.jsonl',JSON.stringify({run,...c,pages,tcp,start,end:new Date().toISOString(),versions,order:i})+'\n');
 console.log(`[${i+1}/${all.length}] ${run}`);
 }catch(e){fs.appendFileSync(raw+'/failures.jsonl',JSON.stringify({run,...c,start,error:e.message})+'\n');throw e;}
}
console.log(dc('exec','-T','client','tc','qdisc','replace','dev','eth0','root','netem','delay','0ms'));
