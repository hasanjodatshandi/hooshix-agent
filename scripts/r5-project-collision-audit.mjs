import Database from 'better-sqlite3';
const db = new Database('./data/agent-memory.db',{readonly:true,fileMustExist:true});
const ids=['60aa33eb-c623-403d-9870-632d82f573af','8f95cd75-f140-4aa3-adda-c502810f04ca'];
console.log('MIGRATIONS',JSON.stringify(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()));
for(const id of ids){
  console.log('PROJECT',JSON.stringify(db.prepare('SELECT id,name,path,status FROM projects WHERE id=?').get(id)));
  console.log('MEMORY_COUNT',id,db.prepare('SELECT COUNT(*) n FROM memory_items WHERE project_id=?').get(id).n);
}
console.log('PROJECT_COUNT',db.prepare('SELECT COUNT(*) n FROM projects').get().n);
console.log('DB_INTEGRITY',db.pragma('quick_check',{simple:true}));
db.close();
