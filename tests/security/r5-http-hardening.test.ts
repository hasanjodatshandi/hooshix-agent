import {describe,expect,it} from "vitest";
import {readHttpBootstrapSecret,readHttpSecurityConfig} from "../../src/infrastructure/config/legacy-http-server.js";
import {HttpWindowLimiter,OperatorWebSessions,HttpPrincipalContexts} from "../../src/infrastructure/server/http-security.js";

describe("R5 HTTP config and bounded security state",()=>{
  it("rejects legacy secrets, external HTTP binding without a trusted HTTPS origin, and wildcard browser CORS",()=>{
    expect(()=>readHttpBootstrapSecret({MCP_ACCESS_TOKEN:"fixture"})).toThrow(/deprecated/);
    expect(()=>readHttpBootstrapSecret({MCP_API_KEY:"fixture"})).toThrow(/unsupported/);
    expect(()=>readHttpSecurityConfig({MCP_BIND_HOST:"0.0.0.0"})).toThrow(/MCP_PUBLIC_BASE_URL/);
    expect(()=>readHttpSecurityConfig({MCP_BIND_HOST:"0.0.0.0",MCP_PUBLIC_BASE_URL:"http://example.invalid"}))
      .toThrow(/HTTPS/);
    expect(()=>readHttpSecurityConfig({MCP_BIND_HOST:"0.0.0.0",MCP_PUBLIC_BASE_URL:"https://example.invalid",
      MCP_ALLOWED_ORIGINS:"*"})).toThrow(/valid origins|Invalid URL/);
    const config=readHttpSecurityConfig({MCP_BIND_HOST:"0.0.0.0",
      MCP_PUBLIC_BASE_URL:"https://api.example.invalid",MCP_ALLOWED_ORIGINS:"https://chatgpt.com"});
    expect(config.resource).toBe("https://api.example.invalid/mcp");
    expect(config.allowedOrigins).toEqual(["https://chatgpt.com"]);
  });
  it("enforces both idle and absolute TTL, bounded sessions and logout with fake clock",()=>{
    let now=1000;
    const sessions=new OperatorWebSessions(()=>now,100,300,2);
    const first=sessions.issue();
    const second=sessions.issue();
    expect(sessions.activeCount).toBe(2);
    expect(()=>sessions.issue()).toThrow(/session_limit/);
    expect(sessions.get(first.id)).not.toBeNull();
    now+=99;expect(sessions.get(first.id)).not.toBeNull();
    now+=99;expect(sessions.get(second.id)).toBeNull();
    now+=103;expect(sessions.get(first.id)).toBeNull();
    expect(sessions.activeCount).toBe(0);
    const third=sessions.issue();
    sessions.close(third.id);
    expect(sessions.get(third.id)).toBeNull();
  });
  it("bounds modern principal workspaces independent of the transport session with idle and absolute fake-clock TTL",()=>{
    let now=1000;
    const identities=new HttpPrincipalContexts<{id:number}>(()=>now,100,300,2);
    let created=0;
    const create=()=>({id:++created});
    const alice=identities.get("alice-client",create);
    expect(identities.get("alice-client",create)).toBe(alice);
    identities.get("bob-client",create);
    expect(identities.activeCount).toBe(2);
    expect(()=>identities.get("charlie-client",create)).toThrow(/modern_context_limit/);
    now+=99;
    expect(identities.get("alice-client",create)).toBe(alice);
    now+=2;
    expect(identities.get("alice-client",create)).toBe(alice);
    expect(identities.get("charlie-client",create).id).toBe(3);
    now+=100;
    expect(identities.get("alice-client",create).id).toBe(4);
    now+=201;
    expect(identities.get("alice-client",create).id).toBe(5);
    expect(identities.activeCount).toBe(1);
    const absolute=new HttpPrincipalContexts<{id:number}>(()=>now,200,300,2);
    const initial=absolute.get("principal",create);
    now+=150;expect(absolute.get("principal",create)).toBe(initial);
    now+=150;expect(absolute.get("principal",create)).not.toBe(initial);
  });
  it("limits per-key rates, returns bounded Retry-After, expires windows and refuses unbounded identities",()=>{
    let now=1000;
    const limiter=new HttpWindowLimiter(2,1000,()=>now,1);
    expect(limiter.allow("a").allowed).toBe(true);
    expect(limiter.allow("a").allowed).toBe(true);
    expect(limiter.allow("a")).toEqual({allowed:false,retryAfter:1});
    expect(limiter.allow("b").allowed).toBe(false);
    now+=1001;
    expect(limiter.allow("b").allowed).toBe(true);
    expect(limiter.allow("a").allowed).toBe(false);
  });
});
