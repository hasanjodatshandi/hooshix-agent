import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const dbPath=path.resolve('data/agent-memory.db');
const db=new Database(dbPath,{fileMustExist:true});
const keepId='8f95cd75-f140-4aa3-adda-c502810f04ca',archiveId='60aa33eb-c623-403d-9870-632d82f573af';
const keep=db.prepare('SELECT * FROM projects WHERE id=?').get(keepId),duplicate=db.prepare('SELECT * FROM projects WHERE id=?').get(archiveId);
if(!keep||!duplicate||!keep.name.startsWith('TEST 7 -')||!duplicate.name.startsWith('TEST 7 -')||
   path.win32.normalize(keep.path).replace(/[\\/]+$/,'').toLowerCase()!==path.win32.normalize(duplicate.path).replace(/[\\/]+$/,'').toLowerCase())
  throw new Error('Refusing repair: exact expected test-only collision was not verified.');
for(const table of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all())
  if(/project_id|REFERENCES projects/i.test(table.sql??'')&&db.prepare('SELECT COUNT(*) n FROM "'+table.name+'" WHERE project_id=?').get(archiveId).n!==0)
    throw new Error('Refusing repair: dependent records in '+table.name);
const directory=path.resolve('data/backups');fs.mkdirSync(directory,{recursive:true});
const backup=path.join(directory,'agent-memory.before-r5-collision-repair.'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');
try{
  await db.backup(backup);
  db.transaction(()=>{
    db.exec('CREATE TABLE IF NOT EXISTS project_identity_collision_archive (id TEXT PRIMARY KEY, original_json TEXT NOT NULL, preserved_at TEXT NOT NULL, reason TEXT NOT NULL)');
    db.prepare('INSERT INTO project_identity_collision_archive(id,original_json,preserved_at,reason) VALUES (?,?,?,?)')
      .run(archiveId,JSON.stringify(duplicate),new Date().toISOString(),'Duplicate test-only project path, preserved to restore canonical project identity');
    if(db.prepare('DELETE FROM projects WHERE id=?').run(archiveId).changes!==1)throw new Error('Archive/delete count mismatch');
  })();
  if(db.pragma('quick_check',{simple:true})!=='ok')throw new Error('Post-repair SQLite integrity failed');
  console.log('BACKUP',backup,'ARCHIVED_ID',archiveId,'PRESERVED',!!db.prepare('SELECT original_json FROM project_identity_collision_archive WHERE id=?').get(archiveId),'REMAINING_PROJECTS',db.prepare('SELECT COUNT(*) n FROM projects').get().n,'INTEGRITY','ok');
}finally{db.close();}
