"use client";
import {useEffect} from 'react';import {useRouter,useSearchParams} from 'next/navigation';
import type {Options,Payload} from './types';
export default function ProductsTable(p:Options&{payload?:Payload}){
 const router=useRouter(), params=useSearchParams();
 useEffect(()=>{document.documentElement.dataset.interactive=p.action;},[p.action]);
 function go(page:number){const q=new URLSearchParams(params.toString());q.set('page',String(page));q.set('a',String(Number(p.action)+1));
 performance.mark('action-'+q.get('a'));router.push('/?'+q.toString(),{scroll:false});}
 return <main><h1>Product analytics</h1><button onClick={()=>go(Math.max(1,p.page-1))}>Prev</button><button onClick={()=>go(p.page+1)}>Next</button>
 <p>Page {p.page}; page size {p.limit} rows</p>
 <table data-response={p.payload?.id}><thead><tr>{['Name','Category','Distinct orders','Rating','Stock'].map(x=><th key={x}>{x}</th>)}</tr></thead>
 <tbody>{p.payload?.data.map((v,i)=><tr key={v.id} data-visible={i===0?p.action:undefined} data-product={v.id}>
 <td>{v.name}</td><td>{v.category}</td><td>{v.total_orders}</td><td>{Number(v.avg_rating).toFixed(1)}</td><td>{v.stock}</td></tr>)}</tbody></table></main>;
}
