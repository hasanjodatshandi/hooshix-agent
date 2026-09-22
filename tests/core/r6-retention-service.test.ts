import {describe,expect,it,vi,afterEach} from "vitest";
import {withAgentDatabase} from "../../src/core/memory/database.js";
import {createRetentionPolicy,runRetention,type RetentionReport}
  from "../../src/core/memory/database/cleanup.js";
import {startPeriodicRetention} from "../../src/infrastructure/server/retention-scheduler.js";

afterEach(()=>vi.useRealTimers());

describe("R6.02 per-table retention policy and periodic scheduler",()=>{
  const now=Date.parse("2026-09-22T00:00:00.000Z");
  const old="2000-01-01T00:00:00.000Z";
  const recent="2026-09-21T00:00:00.000Z";
  function seed(){
    withAgentDatabase(db=>{
      for(const [id,status] of [["terminal","completed"],["active","running"]] as const){
        db.prepare("INSERT INTO tasks(id,description,status,created_at,updated_at) VALUES(?,?,?,?,?)")
          .run(id,"R6 retention fixture",status,old,old);
        db.prepare("INSERT INTO agent_checkpoints(task_id,step_id,step_index,state,created_at,updated_at) VALUES(?,?,?,?,?,?)")
          .run(id,1,0,"done",old,old);
      }
      for(const [id,created] of [["old-call",old],["new-call",recent]]){
        db.prepare("INSERT INTO tool_calls(correlation_id,tool,status,created_at) VALUES(?,?,?,?)")
          .run(id,"read_file","success",created);
      }
      for(const [id,status] of [["done","completed"],["active","started"]] as const){
        db.prepare("INSERT INTO recovery_events(recovery_id,correlation_id,action,reason,retry_count,started_at,status) VALUES(?,?,?,?,?,?,?)")
          .run(id,"r6","retry","fixture",1,old,status);
      }
      for(const status of ["consumed","pending"]){
        db.prepare("INSERT INTO approval_requests(task_id,step_id,risk,reason,status,created_at) VALUES(?,?,?,?,?,?)")
          .run("terminal",1,"low","fixture",status,old);
      }
      for(const [id,restoredAt] of [["restored","done"],["needed",null],["absent","absent"]] as const){
        db.prepare("INSERT INTO file_backups(id,correlation_id,path,content,created_at,restored_at) VALUES(?,?,?,?,?,?)")
          .run(id,"r6","fixture.txt",Buffer.from("fixture"),old,restoredAt);
      }
    });
  }
  it("reports exact eligible rows in dry-run without deleting any record, then removes only terminal classes",()=>{
    seed();
    const policy=createRetentionPolicy(90);
    expect(Object.keys(policy).sort()).toEqual(
      ["toolCalls","checkpoints","recoveryEvents","approvals","restoredBackups"].sort());
    const report=runRetention({policy,nowMs:now,dryRun:true});
    expect(report.mode).toBe("dry-run");
    expect(report.counts).toEqual({toolCalls:1,checkpoints:1,recoveryEvents:1,approvals:1,restoredBackups:1});
    expect(report.total).toBe(5);
    const dryAgain=runRetention({policy,nowMs:now,dryRun:true});
    expect(dryAgain.counts).toEqual(report.counts);
    const deleted=runRetention({policy,nowMs:now});
    expect(deleted.mode).toBe("delete");
    expect(deleted.counts).toEqual(report.counts);
    expect(runRetention({policy,nowMs:now}).total).toBe(0);
    withAgentDatabase(db=>{
      expect((db.prepare("SELECT COUNT(*) AS n FROM tool_calls").get() as {n:number}).n).toBe(1);
      expect((db.prepare("SELECT task_id FROM agent_checkpoints").all() as Array<{task_id:string}>)
        .map(x=>x.task_id)).toEqual(["active"]);
      expect((db.prepare("SELECT status FROM recovery_events").all() as Array<{status:string}>)
        .map(x=>x.status)).toEqual(["started"]);
      expect((db.prepare("SELECT status FROM approval_requests").all() as Array<{status:string}>)
        .map(x=>x.status)).toEqual(["pending"]);
      expect((db.prepare("SELECT id FROM file_backups ORDER BY id").all() as Array<{id:string}>)
        .map(x=>x.id)).toEqual(["absent","needed"]);
      expect((db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {n:number}).n).toBe(2);
    });
  });
  it("enforces independent days per category and rejects unsafe policies and clocks",()=>{
    seed();
    const policy=createRetentionPolicy(90,{toolCalls:36500,approvals:1});
    const report=runRetention({policy,nowMs:now,dryRun:true});
    expect(report.counts.toolCalls).toBe(0);
    expect(report.counts.approvals).toBe(1);
    expect(report.cutoffs.toolCalls).not.toBe(report.cutoffs.approvals);
    expect(()=>createRetentionPolicy(0)).toThrow(/Retention/);
    expect(()=>createRetentionPolicy(90,{toolCalls:1.5})).toThrow(/toolCalls/);
    expect(()=>runRetention({policy,nowMs:Number.NaN,dryRun:true})).toThrow(/clock/);
    expect(()=>runRetention({policy:{...policy,restoredBackups:-1},nowMs:now,dryRun:true}))
      .toThrow(/restoredBackups/);
  });
  it("executes immediately and periodically, cancels on stop, and reports errors without stopping subsequent ticks",()=>{
    vi.useFakeTimers();
    const report:RetentionReport={mode:"dry-run",at:new Date(now).toISOString(),
      cutoffs:{toolCalls:old,checkpoints:old,recoveryEvents:old,approvals:old,restoredBackups:old},
      counts:{toolCalls:0,checkpoints:0,recoveryEvents:0,approvals:0,restoredBackups:0},total:0};
    let calls=0;
    const errors:unknown[]=[];
    const seen:RetentionReport[]=[];
    const stop=startPeriodicRetention({intervalMs:1000,run:()=>{
      calls++;
      if(calls===1)throw new Error("fixture failure");
      return report;
    },onReport:r=>seen.push(r),onError:error=>errors.push(error)});
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(calls).toBe(4);
    expect(seen).toHaveLength(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(calls).toBe(4);
    expect(()=>startPeriodicRetention({intervalMs:0,run:()=>report})).toThrow(/interval/);
  });
});
