import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {runWithTrustedInboundIdentity} from "../../src/core/runtime/r2-trusted-inbound-identity.js";
import {
  saveProject,getProject,deleteProject,archiveProject,listProjects,
  saveMemoryItem,getMemoryItem,deleteMemoryItem,listMemoryItems,
} from "../../src/core/memory/task-repository.js";
import {resetAgentDatabase} from "../../src/core/memory/database/index.js";

/**
 * AUDIT-M2 — project and memory tools had no principal ownership. Any
 * authenticated client could read, overwrite or delete another client's project
 * context and memory notes. Records are now scoped by principal_id; this proves
 * the isolation at the repository layer (the tool layer passes the same id).
 */
describe("principal isolation for project and memory records",()=>{
  const ALICE="11111111-1111-1111-1111-111111111111" as never;
  const BOB="22222222-2222-2222-2222-222222222222" as never;

  beforeEach(()=>{resetAgentDatabase();});
  afterEach(()=>{resetAgentDatabase();});

  function as<T>(principalId:never,run:()=>T):T{
    return runWithTrustedInboundIdentity({
      principal:{id:principalId,permission:"DEVELOPER" as never,origin:"http_oauth",scopes:[]},
      sessionId:"session-"+principalId as never,
    },run);
  }

  describe("projects",()=>{
    it("hides, and refuses to mutate, another principal's project",()=>{
      const id=as(ALICE,()=>saveProject({name:"Alice API",path:"D:/projects/alice",principalId:ALICE}));
      // Bob cannot see it
      expect(as(BOB,()=>getProject(id,BOB))).toBeNull();
      // Bob cannot list it
      expect(as(BOB,()=>listProjects(50,0,undefined,BOB)).items).toEqual([]);
      expect(as(ALICE,()=>listProjects(50,0,undefined,ALICE)).items.length).toBe(1);
      // Bob cannot archive or delete it
      expect(as(BOB,()=>archiveProject(id,BOB))).toBe(false);
      expect(as(BOB,()=>deleteProject(id,BOB))).toBe(false);
      expect(as(ALICE,()=>getProject(id,ALICE))).not.toBeNull();
    });
    it("rejects an update to a project owned by another principal",()=>{
      const id=as(ALICE,()=>saveProject({name:"Alice API",path:"D:/projects/alice",principalId:ALICE}));
      expect(()=>as(BOB,()=>saveProject({id,name:"Hijacked",path:"D:/projects/alice",principalId:BOB})))
        .toThrow(/PROJECT_NOT_OWNED/);
    });
  });

  describe("memory",()=>{
    it("never returns another principal's memory notes",()=>{
      const aliceMemory=as(ALICE,()=>saveMemoryItem({kind:"decision",content:"use postgres",principalId:ALICE}));
      const bobMemory=as(BOB,()=>saveMemoryItem({kind:"decision",content:"use mysql",principalId:BOB}));
      expect(as(BOB,()=>getMemoryItem(aliceMemory,BOB))).toBeNull();
      expect(as(ALICE,()=>getMemoryItem(bobMemory,ALICE))).toBeNull();
      const bobList=as(BOB,()=>listMemoryItems({limit:100,principalId:BOB}));
      expect(bobList.items.length).toBe(1);
      expect(bobList.items[0].content).toBe("use mysql");
      // Bob cannot delete Alice's note
      expect(as(BOB,()=>deleteMemoryItem(aliceMemory,BOB))).toBe(false);
      expect(as(ALICE,()=>getMemoryItem(aliceMemory,ALICE))).not.toBeNull();
    });
  });
});
