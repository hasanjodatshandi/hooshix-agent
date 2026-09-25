import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const server=http.createServer((req,res)=>{
 if(req.url?.startsWith('/capture')){
   res.setHeader('content-type','text/html');
   res.end('<pre id="result">'+JSON.stringify({origin:req.headers.origin,site:req.headers['sec-fetch-site'],mode:req.headers['sec-fetch-mode']})+'</pre>');return;
 }
 const policy=req.url?.includes('same-origin')?'same-origin':'no-referrer';
 res.setHeader('Referrer-Policy',policy);
 res.setHeader('content-type','text/html');
 res.end('<form id="f" method="POST" action="/capture"><input type="hidden" name="field" value="test"></form><script>document.getElementById("f").submit()</script>');
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
for(const policy of ['no-referrer','same-origin']){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hx-origin-'));
 const output=await new Promise(resolve=>{
  const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir='+dir,'--timeout=9000','--virtual-time-budget=1500','--dump-dom','http://127.0.0.1:'+server.address().port+'/'+policy],{windowsHide:true});
  let data='';child.stdout.on('data',v=>data+=v.toString());child.on('close',()=>resolve(data.match(/<pre id="result">([^<]*)<\/pre>/)?.[1]??'no capture'));
 });
 console.log(policy,output);
}
server.close();
