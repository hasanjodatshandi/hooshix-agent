import {describe,expect,it} from "vitest";
import {createShutdownController} from "../../src/infrastructure/server/graceful-shutdown.js";

/**
 * H2 — shutdown must drain in-flight requests, not process.exit(0) mid-handler.
 * The previous SIGTERM path closed the database and exited immediately, which
 * severed any HTTP handler still writing a response and could leave a task
 * recorded as "running" forever. The controller is exercised with an injectable
 * exit function because process.exit cannot fire inside a test worker.
 */
describe("H2 graceful shutdown drains before exit",()=>{
  it("drains the listener, then releases resources, then exits 0",()=>{
    const calls:string[]=[];
    const exits:number[]=[];
    // A listener whose close() resolves synchronously once responses have landed.
    const server:any={close:(cb:()=>void)=>{calls.push("close");cb();}};
    const controller=createShutdownController(server,{onShutdown:()=>calls.push("onShutdown")},
      (code)=>{exits.push(code);});
    controller.shutdown("SIGTERM");
    expect(calls).toEqual(["close","onShutdown"]);
    expect(exits).toEqual([0]);
  });
  it("exits immediately with no listener, after releasing resources",()=>{
    const calls:string[]=[];const exits:number[]=[];
    const controller=createShutdownController(undefined,{onShutdown:()=>calls.push("onShutdown")},
      (code)=>{exits.push(code);});
    controller.shutdown("SIGTERM");
    expect(calls).toEqual(["onShutdown"]);
    expect(exits).toEqual([0]);
  });
  it("a second signal forces an immediate exit 1",()=>{
    const exits:number[]=[];
    let pending:(()=>void)|null=null;
    const server:any={close:(cb:()=>void)=>{pending=cb;}};
    const controller=createShutdownController(server,{},(code)=>{exits.push(code);});
    controller.shutdown("SIGTERM");       // starts draining, does not exit yet
    expect(exits).toEqual([]);
    controller.shutdown("SIGINT");        // operator double-taps
    expect(exits).toEqual([1]);
    pending!();                           // late drain callback must not exit again
    expect(exits).toEqual([1]);
  });
  it("never leaves the process hanging if a connection never drains",async()=>{
    // Pin the grace to its 10ms minimum so this does not wait the 5s default.
    const previous=process.env.HOOSHIX_TERMINATION_GRACE_MS;
    process.env.HOOSHIX_TERMINATION_GRACE_MS="10";
    try{
      const exits:number[]=[];
      const server:any={close:()=>{/* never calls back: stuck keep-alive socket */}};
      const controller=createShutdownController(server,{},(code)=>{exits.push(code);});
      controller.shutdown("SIGTERM");
      expect(exits).toEqual([]);
      await new Promise(resolve=>setTimeout(resolve,150));   // well past the 10ms grace
      expect(exits).toEqual([1]);
    }finally{
      if(previous===undefined) delete process.env.HOOSHIX_TERMINATION_GRACE_MS;
      else process.env.HOOSHIX_TERMINATION_GRACE_MS=previous;
    }
  });
});
