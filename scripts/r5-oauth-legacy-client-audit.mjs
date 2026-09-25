import Database from 'better-sqlite3';
const db = new Database('./data/agent-memory.db',{readonly:true,fileMustExist:true});
const id = 'hooshix-auto-6BL5VlSbmpQ';
const redirect = 'https://chatgpt.com/connector/oauth/1Y2ju8KjMR7a';
try {
  console.log(JSON.stringify({
    migration16:!!db.prepare('SELECT 1 FROM schema_migrations WHERE version=16').get(),
    totalClients:db.prepare('SELECT COUNT(*) AS n FROM oauth_registered_clients').get().n,
    oldClientExists:!!db.prepare('SELECT 1 FROM oauth_registered_clients WHERE client_id=?').get(id),
    oldClientRedirectMatches:(()=>{const row=db.prepare('SELECT redirect_uris_json FROM oauth_registered_clients WHERE client_id=?').get(id);return row ? JSON.parse(row.redirect_uris_json).includes(redirect):false})(),
    dbIntegrity:db.pragma('quick_check',{simple:true})
  }));
} finally{db.close();}
