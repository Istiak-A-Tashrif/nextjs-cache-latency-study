import ProductsTable from './ProductTable';
import type {Options,Payload} from './types';
export default async function ProductsServer(p:Options){
 const u=`http://api:5001/api/products?run=${p.run}&page=${p.page}&limit=${p.limit}&be=${+p.be}`;
 const res=await fetch(u,{cache:p.fe?'force-cache':'no-store'});
 if(!res.ok)throw new Error('API '+res.status);const payload:Payload=await res.json();
 return <ProductsTable key={p.action} {...p} payload={payload}/>;
}
