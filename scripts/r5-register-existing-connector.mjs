import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const db=new Database('./data/agent-memory.db',{fileMustExist:true});
const id='hooshix-auto-6BL5VlSbmpQ';
const uri='https://chatgpt.com/connector/oauth/1Y2ju8KjMR7a';
try {
 const prior=db.prepare('SELECT redirect_uris_json FROM oauth_registered_clients WHERE client_id=?').get(id);
 if(prior)throw new Error('client already registered; review original registration before changing it');
 const folder=path.resolve('./data/backups');fs.mkdirSync(folder,{recursive:true});
 const backup=path.join(folder,'oauth-clients-before-legacy-reconnect-'+Date.now()+'.db');
 await db.backup(backup);
 db.prepare('INSERT INTO oauth_registered_clients(client_id,redirect_uris_json,registered_at) VALUES(?,?,?)')
   .run(id,JSON.stringify([uri]),Date.now());
 const row=db.prepare('SELECT client_id,redirect_uris_json FROM oauth_registered_clients WHERE client_id=?').get(id);
 console.log(JSON.stringify({backup,registered:row?.client_id===id,redirectExact:JSON.parse(row.redirect_uris_json).includes(uri),dbIntegrity:db.pragma('quick_check',{simple:true})}));
}finally{db.close();}
