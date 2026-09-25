import Database from 'better-sqlite3';
const db=new Database('./data/agent-memory.db',{readonly:true,fileMustExist:true});
const ids=['60aa33eb-c623-403d-9870-632d82f573af','8f95cd75-f140-4aa3-adda-c502810f04ca'];
for(const t of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all()){
  if(/project_id|REFERENCES projects/i.test(t.sql??'')){
    const n=db.prepare('SELECT COUNT(*) n FROM "'+t.name+'" WHERE project_id IN (?,?)').get(...ids).n;
    console.log('DEPENDENCY',t.name,n);
  }
}
console.log('PROJECTS',JSON.stringify(db.prepare('SELECT id,name,path,status FROM projects ORDER BY name').all()));
console.log('ALL_CONFLICT_REFERENCES',db.prepare('SELECT COUNT(*) n FROM memory_items WHERE project_id IN (?,?)').get(...ids).n);
db.close();
