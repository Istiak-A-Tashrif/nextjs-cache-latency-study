import {chromium} from 'playwright';import fs from 'node:fs';
const c=JSON.parse(process.argv[2]);
const emit=x=>fs.appendFileSync('/results/browser.jsonl',JSON.stringify({time:new Date().toISOString(),run:c.run,phase:c.phase,...x})+'\n');
const browser=await chromium.launch({headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try{
 for(let session=0;session<2;session++){
  const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();let errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const steps=session===0?c.pages:[c.pages[0]];
  for(let step=0;step<steps.length;step++){
   const pageNumber=steps[step];
   if(step===0)await page.goto(`http://web:3000/?mode=${c.mode}&run=${c.run}&fe=${+c.fe}&be=${+c.be}&page=${pageNumber}&limit=25&a=0`,{waitUntil:'commit'});
   else await page.getByRole('button',{name:pageNumber>steps[step-1]?'Next':'Prev',exact:true}).click();
   await page.waitForFunction(a=>window.__visible?.some(v=>v.action===String(a)&&v.frame!==null),step,{timeout:30000});
   const rec=await page.evaluate(a=>{const v=window.__visible.find(v=>v.action===String(a)&&v.frame!==null);
    const start=a===0?0:performance.getEntriesByName('action-'+a).at(-1).startTime;
    return {...v,start,domMs:v.dom-start,visibleMs:v.frame-start,
      product:Number(document.querySelector('[data-visible]')?.dataset.product),
      ttfb:a===0?performance.getEntriesByType('navigation')[0].responseStart:null};},step);
   if(rec.domMs<0||rec.visibleMs<rec.domMs||rec.product!==(pageNumber-1)*25+1)throw Error('Invalid endpoint or wrong page '+JSON.stringify(rec));
   emit({session,step,page:pageNumber,action:step===0?'initial':'navigation',...rec,errors});errors=[];
   await page.waitForFunction(a=>document.documentElement.dataset.interactive===String(a),step);
  }
  await context.close();
 }
 console.log(JSON.stringify({chromium:browser.version(),run:c.run}));
}finally{await browser.close();}
