// Host orchestrator. All Docker mutations are restricted to project unibench.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync,spawn} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));process.chdir(root);
const raw=path.resolve(root,process.env.UNI_RAW||'../results/raw');fs.mkdirSync(raw,{recursive:true});
const event=x=>fs.appendFileSync(raw+'/batches.jsonl',JSON.stringify({at:new Date().toISOString(),...x})+'\n');
export function guard(){try{const p=execFileSync('pgrep',['-f','harness.mjs'],{encoding:'utf8'}).trim();let identity='exited before identity capture';try{identity=execFileSync('ps',['-p',p.split(/\s+/).join(','),'-o','pid=,comm=,lstart='],{encoding:'utf8'}).trim();}catch{};event({event:'guard-match',pids:p,identity,pgrep:'matched'});throw Error('Main harness active: '+p+' ('+identity+')');}catch(e){if(e.status===1)return;throw e;}}
export function dc(...a){return execFileSync('docker',['compose','-p','unibench','-f',root+'/docker-compose.yml',...a],{encoding:'utf8',maxBuffer:20e6});}
// Primary sweep: delay on client egress only. Symmetric sweep: half the delay on client egress and half on web/api egress toward the client only
// (a destination-filtered netem band applied from a sidecar sharing each container's network namespace), so the added round trip is the same and
// the internal web-to-api link stays unshaped. The Docker VM has no ifb device, so ingress shaping inside the client is not available.
export function shape(delay,symmetric){
 const half=symmetric?delay/2:delay;
 dc('exec','-T','client','tc','qdisc','replace','dev','eth0','root','netem','delay',half+'ms');
 if(!symmetric)return;
 const client=execFileSync('docker',['inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',dc('ps','-q','client').trim()],{encoding:'utf8'}).trim();
 for(const service of ['web','api']){
  const id=dc('ps','-q',service).trim();
  execFileSync('docker',['run','--rm','--cap-add','NET_ADMIN','--network','container:'+id,'unibench-client','sh','-c',
   `tc qdisc del dev eth0 root 2>/dev/null || true; tc qdisc add dev eth0 root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 && tc qdisc add dev eth0 parent 1:3 handle 30: netem delay ${half}ms && tc filter add dev eth0 protocol ip parent 1:0 prio 1 u32 match ip dst ${client}/32 flowid 1:3`],{stdio:'ignore'});
 }
}
export async function monitored(args){guard();event({event:'batch-start',args,pgrep:'empty'});
 const child=spawn('docker',['compose','-p','unibench','-f',root+'/docker-compose.yml',...args],{stdio:['ignore','pipe','pipe']});
 const wake=spawn('caffeinate',['-i','-s','-w',String(child.pid)],{stdio:'ignore'});let text='',err='',blocked=null;
 child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>err+=x);
 const stopClient=()=>execFileSync('docker',['compose','-p','unibench','-f',root+'/docker-compose.yml','stop','-t','0','client'],{stdio:'ignore'});
 const poll=setInterval(()=>{try{guard();}catch(e){if(!blocked){blocked=e.message;stopClient();child.kill('SIGTERM');}}},250);
 const code=await new Promise(ok=>child.on('exit',ok));clearInterval(poll);wake.kill();
 try{guard();}catch(e){blocked=e.message;stopClient();}
 event({event:'batch-end',args,code,pgrep:blocked||'empty'});
 if(blocked||code!==0)throw Error(blocked||err||'docker command failed');return text;
}
function rand(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffle(a,random){for(let i=a.length-1;i>0;i--){let j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const command=process.argv[2]||'run';
if(command==='library') { /* functions above are exported; entry below is guarded */ } else {
guard();
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
const symmetric=command==='symmetric';const delays=command==='smoke'?[0]:symmetric?[40,170]:[0,40,170];const prefix=command==='smoke'?'smoke':symmetric?'symmetric':'primary';
const all=[];for(let seed=1;seed<=reps;seed++)for(const delay of delays)for(const mode of ['csr','ssr'])for(const fe of [false,true])for(const be of [false,true])all.push({seed,delay,mode,fe,be});
shuffle(all,rand(symmetric?20261023:20261020));
const manifestPath=raw+'/'+prefix+'-manifest.json';
if(fs.existsSync(manifestPath)){
 const prior=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(JSON.stringify(prior.configs)!==JSON.stringify(all))throw Error('Existing manifest differs: preserve/archive raw logs before a fresh sweep');
}else fs.writeFileSync(manifestPath,JSON.stringify({created:new Date().toISOString(),reps,delays,orderSeed:symmetric?20261023:20261020,shaping:symmetric?'symmetric: half of the delay on client egress and half on client ingress':'client egress only',configs:all},null,2));
const completedRaw=new Set(fs.existsSync(raw+'/runs.jsonl')?fs.readFileSync(raw+'/runs.jsonl','utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x).run):[]);
const completed=new Set([...completedRaw].map(x=>x.replace(/-retry[0-9]+$/, '')));
if(all.every(c=>completed.has(`${prefix}-s${c.seed}-d${c.delay}-${c.mode}-f${+c.fe}-b${+c.be}`))){console.log('All requested runs already recorded; no new measurement launched.');process.exit(0);}
// Runtime/JIT warm-up on sacrificial run namespaces, with no primary keys populated.
shape(0,symmetric);
for(let ready=0;;ready++){
 try{await monitored(['exec','-T','client','node','tcp.mjs','web','3000']);break;}catch(e){if(ready===59||String(e).includes('Main harness active'))throw e;await new Promise(ok=>setTimeout(ok,500));}
}
for(const mode of ['csr','ssr'])for(const fe of [false,true])for(const be of [false,true]){
 const c={run:`warm-${prefix}-${Date.now()}-${mode}-${+fe}-${+be}`,mode,fe,be,pages:[195,196,195,196,197,196],phase:'warmup'};
 await monitored(['exec','-T','client','node','runner.mjs',JSON.stringify(c)]);
}
for(let i=0;i<all.length;i++){
 const c=all[i],baseRun=`${prefix}-s${c.seed}-d${c.delay}-${c.mode}-f${+c.fe}-b${+c.be}`;if(completed.has(baseRun))continue;
 const priorFailures=fs.existsSync(raw+'/failures.jsonl')?fs.readFileSync(raw+'/failures.jsonl','utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
 const attempts=priorFailures.filter(x=>x.run===baseRun||x.run.startsWith(baseRun+'-retry')).length;
 const run=attempts?baseRun+'-retry'+attempts:baseRun;
 guard();shape(c.delay,symmetric);
 const tcp={};for(const [name,host,port] of [['client_web','web','3000'],['client_api','api','5001']])tcp[name]=JSON.parse(await monitored(['exec','-T','client','node','tcp.mjs',host,port]));
 const base=1+Math.floor(rand(c.seed)()*190),pages=[base,base+1,base,base+1,base+2,base+1];
 const start=new Date().toISOString();
 try{
 const versions=JSON.parse((await monitored(['exec','-T','client','node','runner.mjs',JSON.stringify({...c,run,pages,phase:prefix})])).trim());
 fs.appendFileSync(raw+'/runs.jsonl',JSON.stringify({run,...c,pages,tcp,start,end:new Date().toISOString(),versions,order:i})+'\n');
 console.log(`[${i+1}/${all.length}] ${run}`);
 }catch(e){fs.appendFileSync(raw+'/failures.jsonl',JSON.stringify({run,...c,start,error:e.message})+'\n');throw e;}
}
shape(0,symmetric);

}
