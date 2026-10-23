const express=require('express'), cors=require('cors'), {Pool}=require('pg');
const {createClient}=require('redis'), fs=require('fs'), {randomUUID}=require('crypto');
const pool=new Pool({host:'db',user:'unibench',password:'local-benchmark-only',database:'unibench'});
const redis=createClient({url:'redis://redis:6379'});
redis.on('error',e=>console.error(e));
const query=fs.readFileSync(__dirname+'/query.sql','utf8');
const log=x=>fs.appendFileSync('/results/api.jsonl',JSON.stringify({time:new Date().toISOString(),...x})+'\n');
const app=express(); app.use(cors());app.use(express.json());
app.get('/health',(_,r)=>r.json({ok:true}));
app.get('/api/products',async(req,res)=>{
 const start=performance.now(), id=randomUUID();
 const page=Number(req.query.page||1),limit=Number(req.query.limit||25);
 const run=String(req.query.run||'unassigned'), be=req.query.be==='1';
 if(!Number.isInteger(page)||page<1||page>500||!Number.isInteger(limit)||limit<1||limit>100||!/^[-a-zA-Z0-9]+$/.test(run)) return res.status(400).json({error:'invalid parameters'});
 const key=`${run}:p${page}:l${limit}`;let rows,dbMs=null,redisMs=null,setMs=null,outcome=be?'miss':'off';
 try {
  if(be){const t=performance.now();const value=await redis.get(key);redisMs=performance.now()-t;if(value){rows=JSON.parse(value);outcome='hit';}}
  if(!rows){const t=performance.now();rows=(await pool.query(query,[limit,(page-1)*limit])).rows;dbMs=performance.now()-t;
   if(be){const t=performance.now();await redis.setEx(key,3600,JSON.stringify(rows));setMs=performance.now()-t;}}
  const body=JSON.stringify({id,data:rows});const serviceMs=performance.now()-start;
  log({run,id,page,limit,key,outcome,dbMs,redisMs,setMs,serviceMs,bytes:Buffer.byteLength(body),cacheBytes:Buffer.byteLength(JSON.stringify(rows))});
  res.set('Cache-Control','no-store').type('json').send(body);
 }catch(e){log({run,id,error:e.message});res.status(500).json({error:e.message});}
});
(async()=>{await redis.connect();app.listen(5001,'0.0.0.0');})();
