import crypto from "node:crypto";
import {cleanupOAuthExpired,issueOAuthFamilyId,persistOAuthGrant,
  revokeOAuthAccess,rotateOAuthRefresh,validateOAuthAccess,
  registerOAuthClient,verifyOAuthClientRedirect,
  type OAuthAccessClaims,type OAuthGrantRecord
} from "../adapters/outbound/persistence/sqlite/repositories/oauth-token.adapter.js";
import type { OAuthSettings } from "../infrastructure/config/app-config.js";

/** R7.01: R5-era module constants are now injected from the AppConfig contract. */
const DEFAULT_ACCESS_TTL_MS=3_600_000;
const DEFAULT_REFRESH_TTL_MS=30*24*3_600_000;
const DEFAULT_CODE_TTL_MS=300_000;
const DEFAULT_MAX_PENDING_CODES=128;
const DEFAULT_CLEANUP_INTERVAL_MS=60_000;
const READ_SCOPE="hooshix:read";
const REFRESH_SCOPE="offline_access"; // Standard OAuth scope; not an HooshiX authorization permission.
export const OAUTH_SCOPES=Object.freeze([
  READ_SCOPE,REFRESH_SCOPE,"hooshix:project:write","hooshix:execute","hooshix:task:manage",
  "hooshix:workspace:manage","hooshix:monitoring:read","hooshix:admin"
] as const);
export interface OAuthClaims extends OAuthAccessClaims {readonly kind:"issued"}
interface CodeRecord{
  readonly codeHash:string;readonly challenge:string;readonly resource:string;
  readonly redirectUri:string;readonly clientId:string;readonly scopes:readonly string[];
  readonly principalId:string;readonly expiresAt:number;
}
const hash=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");
function safeEqual(a:string,b:string):boolean{
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function bearer(authorization:string|undefined):string|null{
  if(typeof authorization!=="string" || !/^Bearer [a-zA-Z0-9._~-]{32,300}$/.test(authorization))return null;
  return authorization.slice(7);
}
function validateRequestedScopes(requested:readonly string[]):readonly string[]{
  const set=new Set(requested);
  if(!set.size || [...set].some(s=>!OAUTH_SCOPES.includes(s as typeof OAUTH_SCOPES[number])))
    throw new Error("oauth_invalid_scope");
  return [...set];
}
export class OAuthProvider{
  private readonly bootstrapSecret:string;
  private readonly pending=new Map<string,CodeRecord>();
  private readonly cleanupInterval:ReturnType<typeof setInterval>;
  private readonly now:()=>number;
  private readonly accessTtlMs:number;
  private readonly refreshTtlMs:number;
  private readonly codeTtlMs:number;
  private readonly maxPendingCodes:number;
  private readonly maxRedirectUris:number;
  constructor(bootstrapSecret:string,options:{now?:()=>number;settings?:Partial<OAuthSettings>}={}){
    if(!bootstrapSecret)throw new Error("bootstrap_secret_required");
    this.bootstrapSecret=bootstrapSecret;
    this.now=options.now??Date.now;
    const s=options.settings??{};
    this.accessTtlMs=s.accessTtlMs??DEFAULT_ACCESS_TTL_MS;
    this.refreshTtlMs=s.refreshTtlMs??DEFAULT_REFRESH_TTL_MS;
    this.codeTtlMs=s.codeTtlMs??DEFAULT_CODE_TTL_MS;
    this.maxPendingCodes=s.maxPendingCodes??DEFAULT_MAX_PENDING_CODES;
    this.maxRedirectUris=s.maxRedirectUris??8;
    this.cleanupInterval=setInterval(()=>this.cleanup(),s.cleanupIntervalMs??DEFAULT_CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref?.();
  }
  destroy():void{clearInterval(this.cleanupInterval);}
  /** DCR identity is persisted and bound to every accepted redirect. */
  registerClient(redirectUris:readonly string[]):string{
    if(redirectUris.length<1||redirectUris.length>this.maxRedirectUris||
       redirectUris.some(u=>typeof u!=="string"||u.length>2048)||
       new Set(redirectUris).size!==redirectUris.length)
      throw new Error("oauth_invalid_client_metadata");
    const id="hx_client_"+crypto.randomBytes(24).toString("base64url");
    registerOAuthClient(id,redirectUris,this.now());
    return id;
  }
  isRegisteredClientRedirect(clientId:string,redirectUri:string):boolean{
    return verifyOAuthClientRedirect(clientId,redirectUri);
  }

  /** Operator credential is permitted only at interactive operator POST flows. */
  verifyBootstrapSecret(supplied:string):boolean{
    return safeEqual(supplied,this.bootstrapSecret);
  }
  tokenClaims(authorization:string|undefined,resource:string):OAuthClaims|null{
    const token=bearer(authorization);
    if(!token || !resource || safeEqual(token,this.bootstrapSecret))return null;
    const claims=validateOAuthAccess(hash(token),resource,this.now());
    return claims?{...claims,kind:"issued"}:null;
  }
  verifyToken(authorization:string|undefined,resource:string):boolean{
    return this.tokenClaims(authorization,resource)!==null;
  }
  issueCode(challenge:string,resource:string,redirectUri:string,clientId:string,
    scopes:readonly string[]=[READ_SCOPE],principalId="operator"):string{
    if(!/^[a-zA-Z0-9_-]{43}$/.test(challenge)||!resource||!redirectUri||!clientId||
       clientId.length>256||redirectUri.length>2048)
      throw new Error("oauth_invalid_authorization_request");
    const chosen=validateRequestedScopes(scopes);
    if(this.pending.size>=this.maxPendingCodes)this.cleanup();
    if(this.pending.size>=this.maxPendingCodes)throw new Error("oauth_too_many_pending_codes");
    const code=crypto.randomBytes(32).toString("base64url");
    this.pending.set(hash(code),{codeHash:hash(code),challenge,resource,redirectUri,
      clientId,scopes:chosen,principalId,expiresAt:this.now()+this.codeTtlMs});
    return code;
  }
  exchange(code:string|undefined,verifier:string|undefined,resource:string,
    redirectUri:string,clientId:string):Record<string,unknown>|null{
    if(!code)return null;
    const record=this.pending.get(hash(code));
    this.pending.delete(hash(code)); // single use, including failed PKCE
    if(!record||record.expiresAt<=this.now()||record.resource!==resource||
       record.redirectUri!==redirectUri||record.clientId!==clientId||
       !verifier||!/^[a-zA-Z0-9._~-]{43,128}$/.test(verifier))return null;
    const challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
    if(!safeEqual(challenge,record.challenge))return null;
    return this.issueGrant({clientId:record.clientId,resource:record.resource,
      scopes:record.scopes,principalId:record.principalId});
  }
  refresh(refreshToken:string|undefined,resource:string,clientId?:string):Record<string,unknown>|null{
    if(!refreshToken||!/^hxr_[a-zA-Z0-9_-]{43}$/.test(refreshToken)||!resource)return null;
    const newAccess="hx_"+crypto.randomBytes(32).toString("base64url");
    const newRefresh="hxr_"+crypto.randomBytes(32).toString("base64url");
    const outcome=rotateOAuthRefresh({oldHash:hash(refreshToken),newAccessHash:hash(newAccess),
      newRefreshHash:hash(newRefresh),resource,clientId,now:this.now(),
      accessTtlMs:this.accessTtlMs,refreshTtlMs:this.refreshTtlMs});
    if(outcome.kind!=="rotated")return null;
    return {access_token:newAccess,token_type:"Bearer",expires_in:this.accessTtlMs/1000,
      refresh_token:newRefresh,scope:outcome.grant.scopes.join(" ")};
  }
  revoke(accessToken:string):void{revokeOAuthAccess(hash(accessToken),this.now());}
  private issueGrant(request:{clientId:string;resource:string;scopes:readonly string[];
    principalId:string}):Record<string,unknown>{
    const rawAccess="hx_"+crypto.randomBytes(32).toString("base64url");
    const rawRefresh="hxr_"+crypto.randomBytes(32).toString("base64url");
    const time=this.now();
    const grant:OAuthGrantRecord={tokenHash:hash(rawAccess),familyId:issueOAuthFamilyId(),
      generation:0,principalId:request.principalId,clientId:request.clientId,
      resource:request.resource,scopes:request.scopes,issuedAt:time,
      accessExpiresAt:time+this.accessTtlMs,refreshExpiresAt:time+this.refreshTtlMs};
    persistOAuthGrant(grant,hash(rawRefresh));
    return {access_token:rawAccess,token_type:"Bearer",expires_in:this.accessTtlMs/1000,
      refresh_token:rawRefresh,scope:grant.scopes.join(" ")};
  }
  private cleanup():void{
    const time=this.now();
    for(const [id,code] of this.pending){if(code.expiresAt<=time)this.pending.delete(id);}
    cleanupOAuthExpired(time);
  }
}