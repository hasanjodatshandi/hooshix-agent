import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {afterEach,describe,expect,it} from "vitest";
import {writeWorkspaceFile,modifyWorkspaceFile,createWorkspaceFile,deleteWorkspaceFile} from "../../src/services/filesystem/filesystem-service.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";
import {withAgentDatabase,backupAgentDatabase,runMigrations} from "../../src/core/memory/database.js";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
const sha=(content:string)=>createHash("sha256").update(content).digest("hex");
let fixture:DisposableFixture|undefined;
afterEach(()=>{fixture?.cleanup();fixture=undefined;});
type BackupRow={id:string;path:string;target_canonical_path:string|null;previous_state:string|null;
  previous_revision:string|null;post_mutation_revision:string|null;post_mutation_state:string|null;
  content_ref:string|null;content_hash:string|null;legacy_unversioned:number;content:Buffer;
  created_at:string;restored_at:string|null;};
function backup(id:string):BackupRow {
  return withAgentDatabase(db=>db.prepare("SELECT * FROM file_backups WHERE id=?").get(id) as BackupRow);
}
describe("R4.01 immutable, complete file snapshot schema",()=>{
  it("captures existing-file content, absolute target, byte-exact hash, pre and observed post revision on a write",async()=>{
    const file="tests/runtime-files/r4-existing-"+randomUUID()+".txt";
    try{
      await writeWorkspaceFile(file,"before");
      const result=await writeWorkspaceFile(file,"after");
      const row=backup(result.backupId!);
      expect(path.isAbsolute(row.target_canonical_path!)).toBe(true);
      expect(row.target_canonical_path).toBe(path.resolve(file));
      expect(row.path).toBe(row.target_canonical_path);
      expect(row.previous_state).toBe("present");
      expect(row.previous_revision).toBe(sha("before"));
      expect(row.content.toString("utf8")).toBe("before");
      expect(row.content_ref).toBe("sqlite:file_backups:"+row.id);
      expect(row.content_hash).toBe(sha("before"));
      expect(row.post_mutation_state).toBe("present");
      expect(row.post_mutation_revision).toBe(sha("after"));
      expect(row.legacy_unversioned).toBe(0);
      expect(row.created_at).toBeTruthy();
      expect(row.restored_at).toBeNull();
      const beforeRow=backup(result.backupId!);
      expect(()=>withAgentDatabase(db=>db.prepare("UPDATE file_backups SET previous_state='absent' WHERE id=?").run(row.id))).toThrow();
      expect(()=>withAgentDatabase(db=>db.prepare("UPDATE file_backups SET content=? WHERE id=?").run(Buffer.from("tampered"),row.id))).toThrow();
      expect(backup(row.id)).toEqual(beforeRow);
    }finally{await fs.rm(file,{force:true});}
  });
  it("represents an absent pre-state without treating an empty buffer as a previously existing file",async()=>{
    const file="tests/runtime-files/r4-absent-"+randomUUID()+".txt";
    try{
      const result=await writeWorkspaceFile(file,"new bytes");
      const row=backup(result.backupId!);
      expect(row.previous_state).toBe("absent");
      expect(row.previous_revision).toBeNull();
      expect(row.content_hash).toBeNull();
      expect(row.content_ref).toBeNull();
      expect(row.post_mutation_state).toBe("present");
      expect(row.post_mutation_revision).toBe(sha("new bytes"));
      expect(row.restored_at).toBeNull();
    }finally{await fs.rm(file,{force:true});}
  });
  it("records observed postconditions for modify, create and delete without guessing a deleted-file hash",async()=>{
    const modified="tests/runtime-files/r4-modify-"+randomUUID()+".txt";
    const created="tests/runtime-files/r4-create-"+randomUUID()+".txt";
    try{
      await writeWorkspaceFile(modified,"old");
      const m=await modifyWorkspaceFile(modified,"old","new");
      expect(backup(m.backupId!)).toMatchObject({previous_state:"present",
        previous_revision:sha("old"),post_mutation_state:"present",post_mutation_revision:sha("new")});
      const c=await createWorkspaceFile(created,"brand new");
      expect(c.backupId).toBeTruthy();
      expect(backup(c.backupId!)).toMatchObject({previous_state:"absent",post_mutation_state:"present",
        post_mutation_revision:sha("brand new")});
      const d=await runWithPolicyApproval("delete_file",()=>deleteWorkspaceFile(modified));
      expect(backup(d.backupId!)).toMatchObject({previous_state:"present",previous_revision:sha("new"),
        post_mutation_state:"absent",post_mutation_revision:null});
    }finally{await fs.rm(modified,{force:true});await fs.rm(created,{force:true});}
  });
  it("migrates historical absent marker on a disposable copied DB without inventing a post revision or mutable state",async()=>{
    fixture=createDisposableFixture("r4backups");
    await backupAgentDatabase(fixture.sqlitePath);
    const db=fixture.openDatabase();
    try{
      const id=randomUUID(),present=randomUUID(),now=new Date().toISOString();
      db.prepare("INSERT INTO file_backups(id,correlation_id,path,content,created_at,restored_at,file_revision) VALUES(?,?,?,?,?,?,?)")
        .run(id,"legacy",path.resolve("tests/legacy-absent-"+id),Buffer.alloc(0),now,"absent",null);
      db.prepare("INSERT INTO file_backups(id,correlation_id,path,content,created_at,file_revision) VALUES(?,?,?,?,?,?)")
        .run(present,"legacy",path.resolve("tests/legacy-present-"+present),Buffer.from("old"),now,sha("old"));
      // Historical v13 metadata is simulated on the disposable COPY exclusively.
      db.exec("DROP TRIGGER IF EXISTS r4_backup_immutable");
      for(const column of ["legacy_unversioned","post_mutation_state","post_mutation_revision","content_ref",
        "content_hash","previous_revision","previous_state","target_canonical_path"])
        db.exec("ALTER TABLE file_backups DROP COLUMN "+column);
      db.prepare("DELETE FROM schema_migrations WHERE version=14").run();
      runMigrations(db);
      const a=db.prepare("SELECT * FROM file_backups WHERE id=?").get(id) as BackupRow;
      const b=db.prepare("SELECT * FROM file_backups WHERE id=?").get(present) as BackupRow;
      expect(a.previous_state).toBe("absent");
      expect(a.previous_revision).toBeNull();
      expect(a.content_hash).toBeNull();
      expect(a.restored_at).toBeNull();
      expect(a.post_mutation_revision).toBeNull();
      expect(a.legacy_unversioned).toBe(1);
      expect(b.previous_state).toBe("present");
      expect(b.content_hash).toBe(sha("old"));
      expect(b.previous_revision).toBe(sha("old"));
      expect(b.post_mutation_revision).toBeNull();
      expect(b.legacy_unversioned).toBe(1);
      expect(db.prepare("SELECT version FROM schema_migrations WHERE version=14").get()).toBeTruthy();
    }finally{db.close();}
  });
});