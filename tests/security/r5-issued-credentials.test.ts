import crypto from "node:crypto";
import { afterEach,describe,expect,it } from "vitest";
import {OAuthProvider} from "../../src/mcp/oauth.js";
import {withAgentDatabase} from "../../src/core/memory/database/index.js";

const resource="http://127.0.0.1:34567/mcp";
const bootstrap="r5-isolated-fixture-operator-bootstrap-0123456789";
let providers:OAuthProvider[]=[];
function provider(now?:()=>number){const p=new OAuthProvider(bootstrap,{now});providers.push(p);return p;}
function grant(p:OAuthProvider,scope:string[]=["hooshix:read"],clientId="client-a"){
  const verifier=crypto.randomBytes(32).toString("base64url");
  const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirect="http://127.0.0.1:9876/callback";
  const code=p.issueCode(challenge,resource,redirect,clientId,scope,"operator");
  return {result:p.exchange(code,verifier,resource,redirect,clientId)!,code,verifier,redirect};
}
afterEach(()=>{for(const p of providers)p.destroy();providers=[];});
describe("R5.01-04 persistent issued credential and atomic rotation contracts",()=>{
  it("never accepts the bootstrap secret as MCP bearer; only a resource-bound scoped issued token",()=>{
    const p=provider(),t=grant(p,["hooshix:read","hooshix:monitoring:read"]);
    const access=t.result.access_token as string;
    expect(access).not.toBe(bootstrap);
    expect(p.verifyToken("Bearer "+bootstrap,resource)).toBe(false);
    expect(p.verifyToken("Bearer "+access,resource)).toBe(true);
    expect(p.verifyToken("Bearer "+access,resource+"/other")).toBe(false);
    expect(p.tokenClaims("Bearer "+access,resource)).toMatchObject({
      kind:"issued",principalId:"operator",clientId:"client-a",resource,
      scopes:["hooshix:read","hooshix:monitoring:read"]
    });
    const stored=withAgentDatabase(db=>db.prepare("SELECT token_hash,scopes_json,expires_at FROM oauth_access_tokens WHERE token_hash=?")
      .get(crypto.createHash("sha256").update(access).digest("hex"))) as {token_hash:string;scopes_json:string;expires_at:number};
    expect(stored.token_hash).not.toBe(access);
    expect(stored.scopes_json).not.toContain(bootstrap);
    expect(stored.expires_at).toBeGreaterThan(Date.now());
    const rawDb=withAgentDatabase(db=>db.serialize()) as Buffer;
    expect(rawDb.includes(Buffer.from(access))).toBe(false);
    expect(rawDb.includes(Buffer.from(t.result.refresh_token as string))).toBe(false);
  });
  it("persists credential state across provider instances, and revocation invalidates its entire family",()=>{
    const one=provider(),two=provider();
    const first=grant(one).result,access=first.access_token as string,refresh=first.refresh_token as string;
    expect(two.verifyToken("Bearer "+access,resource)).toBe(true);
    const rotated=two.refresh(refresh,resource,"client-a")!;
    expect(one.verifyToken("Bearer "+(rotated.access_token as string),resource)).toBe(true);
    one.revoke(access);
    expect(two.verifyToken("Bearer "+access,resource)).toBe(false);
    expect(two.verifyToken("Bearer "+(rotated.access_token as string),resource)).toBe(false);
    expect(two.refresh(rotated.refresh_token as string,resource,"client-a")).toBeNull();
  });
  it("rejects expired, wrong-client and wrong-resource grants without consuming a valid refresh",()=>{
    let clock=Date.now();const p=provider(()=>clock),first=grant(p).result;
    expect(p.refresh(first.refresh_token as string,resource,"other-client")).toBeNull();
    expect(p.refresh(first.refresh_token as string,resource+"/other","client-a")).toBeNull();
    clock+=3600_001;
    expect(p.verifyToken("Bearer "+first.access_token,resource)).toBe(false);
    const rotated=p.refresh(first.refresh_token as string,resource,"client-a");
    expect(rotated).not.toBeNull();
    clock+=30*24*3600_000;
    expect(p.refresh(rotated!.refresh_token as string,resource,"client-a")).toBeNull();
  });
  it("one-time refresh rejects replay and revokes successor, including repeated use under contention",async()=>{
    const p=provider(),first=grant(p).result;
    const [one,two]=await Promise.all([
      Promise.resolve().then(()=>p.refresh(first.refresh_token as string,resource,"client-a")),
      Promise.resolve().then(()=>p.refresh(first.refresh_token as string,resource,"client-a"))
    ]);
    expect([one,two].filter(Boolean)).toHaveLength(1);
    const winner=(one??two)!;
    expect(p.verifyToken("Bearer "+winner.access_token,resource)).toBe(false);
    const rows=withAgentDatabase(db=>db.prepare("SELECT consumed_at,rotated_to_hash FROM oauth_refresh_tokens WHERE token_hash=?")
      .get(crypto.createHash("sha256").update(first.refresh_token as string).digest("hex"))) as {
        consumed_at:number|null;rotated_to_hash:string|null
      };
    expect(rows.consumed_at).not.toBeNull();
    expect(rows.rotated_to_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("enforces single-use PKCE S256, client/redirect/resource binding and scope whitelist",()=>{
    const p=provider();
    const verifier=crypto.randomBytes(32).toString("base64url"),challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
    const redirect="http://127.0.0.1:9876/callback";
    expect(()=>p.issueCode("",resource,redirect,"client-a")).toThrow(/invalid_authorization_request/);
    expect(()=>p.issueCode(challenge,resource,redirect,"client-a",["unknown:admin"])).toThrow(/invalid_scope/);
    const code=p.issueCode(challenge,resource,redirect,"client-a");
    expect(p.exchange(code,verifier,resource,redirect,"another-client")).toBeNull();
    expect(p.exchange(code,verifier,resource,redirect,"client-a")).toBeNull();
    const code2=p.issueCode(challenge,resource,redirect,"client-a");
    expect(p.exchange(code2,"wrong",resource,redirect,"client-a")).toBeNull();
    expect(p.exchange(code2,verifier,resource,redirect,"client-a")).toBeNull();
    const code3=p.issueCode(challenge,resource,redirect,"client-a");
    expect(p.exchange(code3,verifier,resource+"/else",redirect,"client-a")).toBeNull();
  });
});
