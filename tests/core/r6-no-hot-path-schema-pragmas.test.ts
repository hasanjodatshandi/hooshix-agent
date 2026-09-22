import {describe,expect,it,vi} from "vitest";
import {openAgentDatabase,withAgentDatabase}
  from "../../src/core/memory/database/index.js";

describe("R6.07 SQLite schema introspection stays outside the hot path",()=>{
  it("runs repeated business reads on the initialized shared connection without PRAGMA or migrations",()=>{
    // Test setup points this process to its isolated fixture database.
    withAgentDatabase(db=>{
      expect((db.prepare("SELECT 1 AS initialized").get() as {initialized:number}).initialized).toBe(1);
    });
    const db=openAgentDatabase();
    const prepared=vi.spyOn(db,"prepare");
    const pragma=vi.spyOn(db,"pragma");
    try{
      for(let i=0;i<500;i++){
        const result=withAgentDatabase(connection=>{
          expect(connection).toBe(db);
          return connection.prepare("SELECT 1 AS ok").get() as {ok:number};
        });
        expect(result.ok).toBe(1);
      }
      expect(prepared).toHaveBeenCalledTimes(500);
      expect(prepared.mock.calls.every(([sql])=>sql==="SELECT 1 AS ok")).toBe(true);
      expect(pragma).not.toHaveBeenCalled();
    }finally{
      prepared.mockRestore();
      pragma.mockRestore();
    }
  });
});
