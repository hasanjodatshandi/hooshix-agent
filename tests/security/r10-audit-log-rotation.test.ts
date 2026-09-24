import fs from "node:fs/promises";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {logCommandAction} from "../../src/memory/command-audit.js";

/**
 * Checklist item 10.9 — "JSONL rotation/permissions/retention documented". The
 * rotation itself is the executable half: the audit log is append-only, so
 * without a size bound a long-running host eventually fills its volume. This
 * test writes across the mechanism and observes the file staying valid JSONL.
 */

describe("10.9 the command audit log is bounded JSONL",()=>{
  // A fresh fixture per test: afterEach removes the tree, so a fixture shared
  // across tests would not survive to the next beforeEach.
  let fixture:ReturnType<typeof createDisposableFixture>;
  let previousLogDir:string|undefined;
  const logFile=()=>path.resolve(fixture.root,"logs","command-actions.log");

  beforeEach(()=>{
    fixture=createDisposableFixture("r10-audit-rotation");
    previousLogDir=process.env.HOOSHIX_LOG_DIR;
    process.env.HOOSHIX_LOG_DIR=path.resolve(fixture.root,"logs");
  });
  afterEach(async()=>{
    if(previousLogDir===undefined)delete process.env.HOOSHIX_LOG_DIR;
    else process.env.HOOSHIX_LOG_DIR=previousLogDir;
    fixture.cleanup();
  });

  it("appends one valid JSONL line per action and redacts a flag=value secret",async()=>{
    const SECRET="REDACTED-MASK-1234567890";
    await logCommandAction({command:"git",args:[`--token=[REDACTED]}`,"status"],status:"success",correlationId:"c1"});
    await logCommandAction({command:"ls",status:"success",correlationId:"c2"});
    const content=await fs.readFile(logFile(),"utf8");
    const lines=content.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({command:"git",status:"success",correlationId:"c1"});
    // The secret value must never survive into the audit line.
    expect(content).not.toContain(SECRET);
  });

  it("keeps the log readable and non-empty after many writes",async()=>{
    for(let i=0;i<5;i++){
      // eslint-disable-next-line no-await-in-loop
      await logCommandAction({command:"bash",args:["-c",`echo ${i}`],status:"success",correlationId:`bulk-${i}`});
    }
    const content=await fs.readFile(logFile(),"utf8");
    const lines=content.trim().split(/\r?\n/);
    expect(lines).toHaveLength(5);
    for(const line of lines) expect(()=>JSON.parse(line as string)).not.toThrow();
  });

  it("rotates the existing log to .1 when a write would exceed the size bound",async()=>{
    // The bound in the source is 10 MiB. Writing 10 MiB in a test is slow, so
    // this seeds a file already above the bound and observes the next write
    // rotating it: the mechanism is what matters, not the exact threshold.
    const big=Buffer.alloc(11*1024*1024,0x61);
    await fs.mkdir(path.dirname(logFile()),{recursive:true});
    await fs.writeFile(logFile(),big);
    await logCommandAction({command:"probe",status:"success",correlationId:"rot1"});
    // The oversized file moved aside; the new line went to a fresh file.
    await expect(fs.stat(logFile()+".1")).resolves.toMatchObject({size:big.length});
    const content=await fs.readFile(logFile(),"utf8");
    expect(content).toContain("rot1");
    expect(content.length).toBeLessThan(1000);
  });

  it("recreates the directory when the whole log tree is removed",async()=>{
    await logCommandAction({command:"ls",status:"success",correlationId:"mk1"});
    await fs.rm(path.dirname(logFile()),{recursive:true,force:true});
    // A missing directory must not lose the audit line.
    await logCommandAction({command:"ls",status:"success",correlationId:"mk2"});
    const content=await fs.readFile(logFile(),"utf8");
    expect(content).toContain("mk2");
    expect(content).not.toContain("mk1");
  });

  it("never serializes a caller-supplied environment verbatim",async()=>{
    await logCommandAction({command:"env",env:{SECRET:"leak-me-xyz"},status:"success",correlationId:"env1"});
    const content=await fs.readFile(logFile(),"utf8");
    expect(content).not.toContain("leak-me-xyz");
    expect(content).toContain("environment");
  });
});
