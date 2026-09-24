import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach,describe,expect,it} from "vitest";
import {saveProject} from "../../src/core/memory/task-repository.js";
import {backupAgentDatabase,runMigrations,withAgentDatabase} from "../../src/core/memory/database/index.js";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {canonicalProjectPath} from "../../src/infrastructure/project-path-identity.js";

let fixture:DisposableFixture|undefined;
afterEach(()=>{fixture?.cleanup();fixture=undefined;});
const row=(id:string)=>withAgentDatabase(db=>db.prepare("SELECT id,path,canonical_path,display_path FROM projects WHERE id=?").get(id)) as {id:string;path:string;canonical_path:string;display_path:string};
function legacy(db:ReturnType<DisposableFixture["openDatabase"]>):void{
  db.exec("DROP TRIGGER projects_canonical_required_insert; DROP TRIGGER projects_canonical_required_update; DROP INDEX idx_projects_canonical_identity;");
  db.exec("ALTER TABLE projects DROP COLUMN canonical_path; ALTER TABLE projects DROP COLUMN display_path;");
  db.prepare("DELETE FROM schema_migrations WHERE version=15").run();
}
function insert(db:ReturnType<DisposableFixture["openDatabase"]>,id:string,projectPath:string):void{
  const now=new Date().toISOString();
  db.prepare("INSERT INTO projects(id,name,path,created_at,updated_at,status) VALUES (?,?,?,?,?,'active')")
    .run(id,"r4-project-"+id,projectPath,now,now);
}
describe("R4.04 canonical project identity and safe copied-v14 migration",()=>{
  it("normalizes paths and enforces a unique canonical identity at the DB boundary",()=>{
    fixture=createDisposableFixture("r4-project");
    const target=path.join(fixture.root,"same");
    fs.mkdirSync(target);
    const id=saveProject({name:"r4-unique-"+randomUUID(),path:target});
    const equivalent=process.platform==="win32"?target.toUpperCase()+path.sep:path.join(target,".");
    expect(()=>saveProject({name:"r4-other-"+randomUUID(),path:equivalent})).toThrow(/already registered/i);
    expect(row(id)).toMatchObject({id,canonical_path:canonicalProjectPath(target),display_path:target});
    expect(()=>withAgentDatabase(db=>db.prepare(
      "INSERT INTO projects(id,name,path,canonical_path,created_at,updated_at) VALUES (?,?,?,?,?,?)"
    ).run(randomUUID(),"R4 duplicate",target+"-alias",canonicalProjectPath(target),
      new Date().toISOString(),new Date().toISOString()))).toThrow(/UNIQUE/);
  });

  it("resolves existing junction/symlink project identity before registration",()=>{
    fixture=createDisposableFixture("r4-symlink");
    const target=path.join(fixture.root,"actual");fs.mkdirSync(target);
    const alias=path.join(fixture.root,"alias");
    try { fs.symlinkSync(target,alias,process.platform==="win32"?"junction":"dir"); }
    catch { return; /* platforms lacking junction privilege are covered by lexical fixture */ }
    const id=saveProject({name:"r4-symlink-"+randomUUID(),path:target});
    expect(()=>saveProject({name:"r4-symlink-dup-"+randomUUID(),path:alias})).toThrow(/already registered/);
    expect(row(id).canonical_path).toBe(canonicalProjectPath(alias));
  });

  it("upgrades a copied v14 database without rewriting project ids or ownership",async()=>{
    fixture=createDisposableFixture("r4-upgrade");
    const root=fixture.root;
    await backupAgentDatabase(fixture.sqlitePath);
    const db=fixture.openDatabase();
    try{
      legacy(db);
      const id=randomUUID();
      const target=path.join(root,"p");
      fs.mkdirSync(target);
      insert(db,id,target+path.sep);
      runMigrations(db);
      const upgraded=db.prepare("SELECT id,path,canonical_path,display_path FROM projects WHERE id=?").get(id) as {id:string;canonical_path:string;display_path:string};
      expect(upgraded).toMatchObject({id,canonical_path:canonicalProjectPath(target),display_path:target+path.sep});
      expect(db.prepare("SELECT version FROM schema_migrations WHERE version=15").get()).toBeTruthy();
      expect(()=>insert(db,randomUUID(),path.join(root,"missing-identity"))).toThrow(/canonical_identity_required/);
    }finally{db.close();}
  });

  it("fails closed on copied v14 canonical collision and rolls back all schema and row edits",async()=>{
    fixture=createDisposableFixture("r4-collision");
    await backupAgentDatabase(fixture.sqlitePath);
    const db=fixture.openDatabase();
    try{
      legacy(db);
      const first=randomUUID(),second=randomUUID();
      const target=path.join(fixture.root,"collision");fs.mkdirSync(target);
      insert(db,first,target);
      insert(db,second,process.platform==="win32"?target.toUpperCase()+path.sep:target+path.sep);
      const before=db.prepare("SELECT id,path FROM projects WHERE id IN (?,?) ORDER BY id").all(first,second);
      expect(()=>runMigrations(db)).toThrow(/PROJECT_CANONICAL_COLLISION/);
      expect(db.prepare("SELECT id,path FROM projects WHERE id IN (?,?) ORDER BY id").all(first,second)).toEqual(before);
      expect(db.prepare("SELECT version FROM schema_migrations WHERE version=15").get()).toBeUndefined();
      expect((db.prepare("PRAGMA table_info(projects)").all() as Array<{name:string}>).some(x=>x.name==="canonical_path")).toBe(false);
    }finally{db.close();}
  });
});
