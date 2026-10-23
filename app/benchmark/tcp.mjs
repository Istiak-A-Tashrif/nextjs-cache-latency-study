import net from 'node:net';
const [host,port]=process.argv.slice(2);const values=[];
for(let i=0;i<11;i++){const t=performance.now();await new Promise((ok,bad)=>{const s=net.connect(Number(port),host,()=>{values.push(performance.now()-t);s.destroy();ok();});s.setTimeout(10000,()=>{s.destroy();bad(Error('TCP timeout'));});s.on('error',bad);});}
console.log(JSON.stringify({host,port:Number(port),samples:values,median:[...values].sort((a,b)=>a-b)[5]}));
