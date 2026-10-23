import ProductsClient from "@/components/ProductsClient";
import ProductsServer from "@/components/ProductsServer";
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string>>}) {
 const p=await searchParams; const opts={page:Number(p.page||1),limit:Number(p.limit||25),run:p.run||'manual',fe:p.fe==='1',be:p.be==='1',action:p.a||'0'};
 return p.mode==='ssr'?<ProductsServer {...opts}/>:<ProductsClient {...opts}/>;
}
