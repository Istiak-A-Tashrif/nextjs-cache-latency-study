"use client";
import {useQuery} from '@tanstack/react-query';
import ProductsTable from './ProductTable';
import type {Options,Payload} from './types';
export default function ProductsClient(p:Options){
 const q=useQuery<Payload>({queryKey:['products',p.run,p.page,p.limit,p.be],queryFn:async()=>{
  const r=await fetch(`http://api:5001/api/products?run=${p.run}&page=${p.page}&limit=${p.limit}&be=${+p.be}`,{cache:'no-store'});
  if(!r.ok)throw new Error('API '+r.status);return r.json();},staleTime:p.fe?3600000:0,gcTime:p.fe?3600000:0,retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false});
 return <ProductsTable key={p.action} {...p} payload={q.data}/>;
}
