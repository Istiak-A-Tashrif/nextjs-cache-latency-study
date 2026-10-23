import './globals.css';import Providers from './Provider';
// Observer is installed in the head before SSR rows are parsed.
const instrument=`window.__visible=[];var seen=new WeakSet();new MutationObserver(function(ms){
 for(var m of ms)for(var n of m.addedNodes){if(n.nodeType!==1)continue;
 var els=n.matches('[data-visible]')?[n]:n.querySelectorAll('[data-visible]');
 for(var el of els){if(seen.has(el))continue;seen.add(el);
 var rec={action:el.dataset.visible,dom:performance.now(),frame:null,response:el.closest('table').dataset.response};
 window.__visible.push(rec);requestAnimationFrame((function(r){return function(){
 var ch=new MessageChannel();ch.port1.onmessage=function(){r.frame=performance.now();ch.port1.close();ch.port2.close();};ch.port2.postMessage(0);};})(rec));
 }}}).observe(document.documentElement,{childList:true,subtree:true});`;
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><head><script dangerouslySetInnerHTML={{__html:instrument}}/></head><body><Providers>{children}</Providers></body></html>}
