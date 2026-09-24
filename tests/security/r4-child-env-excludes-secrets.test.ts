import fs from "node:fs";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {buildChildProcessEnvironment} from "../../src/infrastructure/config/app-config.js";
import {executeShellCommand} from "../../src/services/shell/shell-service.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";

/**
 * Checklist item 4.9 — child process environment excludes unrelated sensitive
 * credentials. This was the only item in section 4 with no test: the shell
 * service previously passed no `env` option to execa, and execa EXTENDS the
 * parent environment by default, so the subprocess inherited everything,
 * including HOOSHIX_BOOTSTRAP_TOKEN and every OAuth secret. The fix is an
 * allowlist plus extendEnv: false.
 *
 * Two layers are proved separately, because they fail differently:
 *  - the pure layer (does the allowlist withhold HOOSHIX_*) is fast and needs
 *    no subprocess at all;
 *  - the integration layer (does the real executeShellCommand actually hand
 *    the child that allowlist) runs one real subprocess.
 */

describe("4.9 child process env excludes sensitive credentials",()=>{
  describe("pure allowlist layer",()=>{
    it("withholds every HOOSHIX_* value from the child environment",()=>{
      const env:Record<string,string|undefined>={
        HOOSHIX_BOOTSTRAP_TOKEN:"probe-bootstrap-secret",
        HOOSHIX_OAUTH_CLIENT_SECRET:"probe-oauth-secret",
        HOOSHIX_API_KEY:"probe-api-key",
        HOOSHIX_DIRECT_AUTO_APPROVE:"1",
        HOOSHIX_DB_PATH:"/tmp/probe.db",
        PATH:"/usr/bin",
        HOME:"/home/probe",
      };
      const childEnv=buildChildProcessEnvironment(env);
      const leaked=Object.keys(childEnv).filter(k=>k.startsWith("HOOSHIX"));
      expect(leaked,`allowlist leaked: ${leaked.join(", ")}`).toEqual([]);
    });
    it("still delivers the variables a command needs to run",()=>{
      const childEnv=buildChildProcessEnvironment({PATH:"/usr/bin",HOME:"/home/probe"});
      expect(childEnv.PATH).toBe("/usr/bin");
      expect(childEnv.HOME).toBe("/home/probe");
    });
    it("omits empty and undefined values rather than sending an empty string",()=>{
      const childEnv=buildChildProcessEnvironment({PATH:"",HOME:undefined});
      expect(Object.keys(childEnv)).toEqual([]);
    });
  });

  describe("real subprocess layer",()=>{
    const fixture=createDisposableFixture("r4-shell-env");

    afterEach(()=>{
      fixture.cleanup();
    });

    it("executeShellCommand hands the child only the allowlisted environment",async()=>{
      // Secrets a real process would hold, all of which the child must not see.
      process.env.HOOSHIX_BOOTSTRAP_TOKEN="probe-bootstrap-secret";
      process.env.HOOSHIX_OAUTH_CLIENT_SECRET="probe-oauth-secret";
      process.env.HOOSHIX_API_KEY="probe-api-key";
      try{
        // The governed approval path for a direct command run outside a Task
        // step: runWithPolicyApproval marks execute_command as approved so the
        // policy layer accepts the fixture root as cwd.
        const received=await runWithPolicyApproval("execute_command",async()=>{
          const dump=path.join(fixture.root,"env-dump.json");
          const result=await executeShellCommand("node",["-e",
            `const fs=require("fs");fs.writeFileSync(${JSON.stringify(dump.replace(/\\/g,"/"))},JSON.stringify(Object.keys(process.env)))`
          ],fixture.root,20000);
          expect(result.exitCode,result.stderr).toBe(0);
          return JSON.parse(fs.readFileSync(dump,"utf8")) as string[];
        });
        const leaked=received.filter(k=>k.startsWith("HOOSHIX"));
        expect(leaked,`subprocess received secrets: ${leaked.join(", ")}`).toEqual([]);
        expect(received).toContain("PATH");
      }finally{
        delete process.env.HOOSHIX_BOOTSTRAP_TOKEN;
        delete process.env.HOOSHIX_OAUTH_CLIENT_SECRET;
        delete process.env.HOOSHIX_API_KEY;
      }
    });
  });
});
