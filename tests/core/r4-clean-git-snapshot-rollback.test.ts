import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {afterEach,describe,expect,it} from "vitest";
import {createDisposableFixture,type DisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {addWorkspaceRoots,removeWorkspaceRoot,setActiveWorkspace} from "../../src/security/workspace-guard.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";
import {captureTaskSnapshot,rollbackTaskSnapshot} from "../../src/core/executor/handlers/task-snapshot-handler.js";
import {findTaskGitSnapshot,storeTaskGitSnapshot} from "../../src/adapters/outbound/persistence/sqlite/repositories/task-snapshot-storage.adapter.js";
import {withAgentDatabase} from "../../src/core/memory/database.js";
let fixture:DisposableFixture|undefined;
let repo:string|undefined;
const extraRoots=new Set<string>();
function git(...args:string[]):string {
  const result=spawnSync("git",args,{cwd:repo,encoding:"utf8"});
  if(result.status!==0) throw new Error("disposable git "+args.join(" ")+" failed: "+result.stderr);
  return result.stdout.trim();
}
function setup():string {
  fixture=createDisposableFixture("r4-git");
  repo=fixture.initializeGit();addWorkspaceRoots([repo]);setActiveWorkspace(repo);
  fs.writeFileSync(path.join(repo,"tracked.txt"),"original");
  git("add","tracked.txt");git("commit","--quiet","-m","fixture initial");
  return repo;
}
afterEach(()=>{
  setActiveWorkspace(process.cwd());
  if(repo){try{removeWorkspaceRoot(repo);}catch{/* fixture cleanup */}}
  for(const extra of extraRoots){try{removeWorkspaceRoot(extra);}catch{/* fixture cleanup */}}
  extraRoots.clear();
  repo=undefined;fixture?.cleanup();fixture=undefined;
});
describe("R4.05/R4.06 exact clean Git snapshot and rollback",()=>{
  it("rejects a dirty repository including untracked user work before recording any snapshot",async()=>{
    const cwd=setup();
    const before=(withAgentDatabase(db=>db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n);
    fs.writeFileSync(path.join(cwd,"untracked-user-work.txt"),"preserve");
    const result=await captureTaskSnapshot(cwd,"r4-dirty");
    expect(result).toMatchObject({snapshotId:"",clean:false,error:"GIT_DIRTY_SNAPSHOT_UNSUPPORTED"});
    expect(fs.readFileSync(path.join(cwd,"untracked-user-work.txt"),"utf8")).toBe("preserve");
    expect((withAgentDatabase(db=>db.prepare("SELECT COUNT(*) n FROM file_backups").get() as {n:number}).n)).toBe(before);
  });

  it("rejects staged and tracked modifications without persisting incomplete snapshots",async()=>{
    const cwd=setup();
    fs.writeFileSync(path.join(cwd,"tracked.txt"),"changed");
    expect((await captureTaskSnapshot(cwd,"r4-worktree")).snapshotId).toBe("");
    git("add","tracked.txt");
    expect((await captureTaskSnapshot(cwd,"r4-index")).error).toBe("GIT_DIRTY_SNAPSHOT_UNSUPPORTED");
  });

  it("captures immutable clean HEAD and branch; approved rollback restores exactly the documented Git state",async()=>{
    const cwd=setup();
    const beforeHead=git("rev-parse","HEAD"),beforeBranch=git("branch","--show-current");
    const snapshot=await captureTaskSnapshot(cwd,"r4-clean");
    expect(snapshot).toMatchObject({clean:true,head:beforeHead,branch:beforeBranch});
    expect(snapshot.snapshotId).toBeTruthy();
    const stored=findTaskGitSnapshot(snapshot.snapshotId)!;
    expect(JSON.parse(stored.content.toString("utf8"))).toMatchObject(
      {schemaVersion:1,kind:"clean_git_snapshot",clean:true,status:"",head:beforeHead,cwd});
    fs.writeFileSync(path.join(cwd,"tracked.txt"),"second version");
    git("add","tracked.txt");git("commit","--quiet","-m","fixture second");
    fs.writeFileSync(path.join(cwd,"untracked.txt"),"later untracked");
    const result=await runWithPolicyApproval("task_rollback",()=>rollbackTaskSnapshot(snapshot.snapshotId,cwd));
    expect(result).toMatchObject({snapshotId:snapshot.snapshotId,rolledBackTo:beforeHead,clean:true,cwd});
    expect(git("rev-parse","HEAD")).toBe(beforeHead);
    expect(git("status","--porcelain=v1","--untracked-files=all")).toBe("");
    expect(fs.readFileSync(path.join(cwd,"tracked.txt"),"utf8")).toBe("original");
    expect(fs.existsSync(path.join(cwd,"untracked.txt"))).toBe(false);
  });

  it("rejects historical dirty/legacy snapshot before destructive Git commands",async()=>{
    const cwd=setup(),head=git("rev-parse","HEAD");
    const id=randomUUID();
    storeTaskGitSnapshot(id,"r4-legacy",cwd,Buffer.from(JSON.stringify({
      head,branch:git("branch","--show-current"),clean:false,status:"?? work.txt",cwd
    })));
    fs.writeFileSync(path.join(cwd,"preserve.txt"),"preserve");
    await expect(runWithPolicyApproval("task_rollback",()=>rollbackTaskSnapshot(id,cwd)))
      .rejects.toThrow(/GIT_SNAPSHOT_UNVERIFIED/);
    expect(fs.readFileSync(path.join(cwd,"preserve.txt"),"utf8")).toBe("preserve");
  });

  it("rejects snapshot repository or branch mismatch and preserves current work",async()=>{
    const cwd=setup(),snapshot=await captureTaskSnapshot(cwd,"r4-bound");
    const other=path.join(fixture!.root,"other");fs.mkdirSync(other);
    addWorkspaceRoots([other]);extraRoots.add(other);setActiveWorkspace(other);
    await expect(runWithPolicyApproval("task_rollback",()=>rollbackTaskSnapshot(snapshot.snapshotId,other)))
      .rejects.toThrow(/GIT_SNAPSHOT_REPOSITORY_MISMATCH/);
    setActiveWorkspace(cwd);
    git("checkout","-b","fixture-other");
    fs.writeFileSync(path.join(cwd,"preserve.txt"),"no reset");
    await expect(runWithPolicyApproval("task_rollback",()=>rollbackTaskSnapshot(snapshot.snapshotId,cwd)))
      .rejects.toThrow(/GIT_SNAPSHOT_BRANCH_MISMATCH/);
    expect(fs.readFileSync(path.join(cwd,"preserve.txt"),"utf8")).toBe("no reset");
  });

  it("requires explicit high-risk task approval even for a known clean snapshot",async()=>{
    const cwd=setup(),snapshot=await captureTaskSnapshot(cwd,"r4-approval");
    await expect(rollbackTaskSnapshot(snapshot.snapshotId,cwd)).rejects.toThrow(/Approval required/);
    expect(git("status","--porcelain=v1","--untracked-files=all")).toBe("");
  });
});
