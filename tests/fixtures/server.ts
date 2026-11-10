import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
export async function fixtureServer(html:string){
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {url:'http://127.0.0.1:'+(server.address() as AddressInfo).port,close:()=>new Promise<void>((r,j)=>server.close(e=>e?j(e):r()))};
}
