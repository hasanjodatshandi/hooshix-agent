import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,describe,expect,it} from "vitest";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {buildChildProcessEnvironment} from "../../src/infrastructure/config/app-config.js";
import {executeShellCommand} from "../../src/services/shell/shell-service.js";
import {spawn} from "../../src/services/spawn.js";
import {runWithPolicyApproval} from "../../src/core/governance/policy-decision-point.js";

/**
 * Checklist item 4.9 — child process environment excludes unrelated sensitive
 * credentials. This was the only item in section 4 with no test: the shell
 * service previously passed no `env` option to execa, and execa EXTENDS the
 * parent environment by default, so the subprocess inherited everything,
 * including HOOSHIX_BOOTSTRAP_TOKEN and every OAuth secret.
 *
 * The leak was originally patched at ONE call site (shell-service), which left
 * git-service, package-service and task-snapshot-handler — 17 more execa calls
 * — still handing every secret to untrusted code (a cloned repo, an npm
 * post-install script). The fix is now structural: services/spawn.ts is the
 * ONLY way to spawn a child, and it forces the allowlist. Four layers prove it:
 *
 *  - the pure layer (does the allowlist withhold HOOSHIX_*) needs no subprocess;
 *  - the choke-point layer (is execa reachable anywhere else?) is a source scan;
 *  - the override layer (does spawn survive a caller TRYING to leak?) runs one
 *    real subprocess;
 *  - the integration layer (does the real executeShellCommand hand the child
 *    that allowlist) runs one real subprocess through the governed path.
 */

describe("4.9 child process env excludes sensitive credentials",()=>{
  const SRC_DIR=fileURLToPath(new URL("../../src",import.meta.url));

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

  describe("single spawn choke point",()=>{
    /** Recursively collect every .ts file under a directory. */
    function collectTsFiles(dir:string):string[]{
      const out:string[]=[];
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        const full=path.join(dir,entry.name);
        if(entry.isDirectory()) out.push(...collectTsFiles(full));
        else if(entry.name.endsWith(".ts")) out.push(full);
      }
      return out;
    }

    it("services/spawn.ts is the only source file that calls execa",()=>{
      // execa( is the spawn primitive. If any module other than the wrapper
      // calls it directly, that module can leak secrets again — exactly how
      // git-service and package-service stayed vulnerable after the first fix.
      const callers=collectTsFiles(SRC_DIR)
        .filter(f=>/(?<![\w$])execa\s*\(/.test(fs.readFileSync(f,"utf8")))
        .map(f=>path.relative(path.dirname(SRC_DIR),f).replace(/\\/g,"/"));
      expect(callers,
        `direct execa() calls found outside the wrapper: ${callers.join(", ")}`)
        .toEqual(["src/services/spawn.ts"]);
    });

    describe("override resistance",()=>{
      const fixture=createDisposableFixture("r4-spawn-override");
      afterEach(()=>{fixture.cleanup();});

      it("spawn drops a caller-supplied env and extendEnv",async()=>{
        process.env.HOOSHIX_BOOTSTRAP_TOKEN="probe-bootstrap-secret";
        try{
          const dump=path.join(fixture.root,"spawn-override-dump.json");
          // A caller actively trying to hand the child a secret — the wrapper
          // must drop env/extendEnv and still emit only the allowlist.
          const result=await spawn("node",["-e",
            `const fs=require("fs");fs.writeFileSync(${JSON.stringify(dump.replace(/\\/g,"/"))},JSON.stringify(Object.keys(process.env)))`
          ],{cwd:fixture.root,env:{HOOSHIX_BOOTSTRAP_TOKEN:"caller-tried-to-leak"},extendEnv:true,reject:false});
          expect(result.exitCode,result.stderr).toBe(0);
          const received=JSON.parse(fs.readFileSync(dump,"utf8")) as string[];
          const leaked=received.filter(k=>k.startsWith("HOOSHIX"));
          expect(leaked,`spawn honored a caller-supplied env: ${leaked.join(", ")}`).toEqual([]);
          expect(received).toContain("PATH");
        }finally{
          delete process.env.HOOSHIX_BOOTSTRAP_TOKEN;
        }
      });
    });
  });

  describe("real subprocess layer",()=>{
    const fixture=createDisposableFixture("r4-shell-env");
    afterEach(()=>{fixture.cleanup();});

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

  describe("Windows packaged-app activation",()=>{

    it("forwards LOCALAPPDATA so the Windows Python launcher resolves instead of hanging",()=>{
      // Regression for the 2026-10-02 retest: python/py resolve to Microsoft
      // App Execution Alias stubs that activate the Windows Python Install
      // Manager (pymanager). pymanager locates its install index under
      // %LOCALAPPDATA%; without the variable it logs "Failed to read unmanaged
      // installs: ... NoneType", decides to install a manager update, and does
      // not return — execute_command then reports a timeout on a machine where
      // the interpreter is installed and healthy. Dropping LOCALAPPDATA from
      // the allowlist reintroduces exactly that hang.
      const childEnv=buildChildProcessEnvironment({
        PATH:"C:\\Windows\\System32",
        LOCALAPPDATA:"C:\\Users\\probe\\AppData\\Local",
      });
      expect(childEnv.LOCALAPPDATA).toBe("C:\\Users\\probe\\AppData\\Local");
    });

    it("python --version resolves through the governed spawn choke point",async()=>{
      if(process.platform!=="win32") return;
      // End-to-end proof through the only spawn path: before LOCALAPPDATA was
      // allowlisted this hung until the tool timed out (pymanager self-update);
      // now the interpreter resolves in well under a second.
      const fixture=createDisposableFixture("r4-python-launcher");
      try{
        const result=await spawn("python",["--version"],{cwd:fixture.root,timeout:20000,reject:false});
        expect(result.timedOut,"python --version timed out — LOCALAPPDATA likely missing from the child env").toBe(false);
        expect(result.exitCode,result.stderr).toBe(0);
        expect(result.stdout.trim()).toMatch(/^Python /);
      }finally{
        fixture.cleanup();
      }
    });
  });
});
