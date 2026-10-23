export type Product={id:number,name:string,category:string,total_orders:string,avg_rating:string,stock:number};
export type Payload={id:string,data:Product[]};
export type Options={page:number,limit:number,run:string,fe:boolean,be:boolean,action:string};
