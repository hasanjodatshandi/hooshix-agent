import { withAgentDatabase } from "../../../../../core/memory/database.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface OAuthGrantRecord {
  readonly tokenHash: string;
  readonly principalId: string;
  readonly clientId: string;
  readonly resource: string;
  readonly scopes: readonly string[];
  readonly familyId: string;
  readonly generation: number;
  readonly issuedAt: number;
  readonly accessExpiresAt: number;
  readonly refreshExpiresAt: number;
}
export interface OAuthAccessClaims {
  readonly principalId:string;
  readonly clientId:string;
  readonly resource:string;
  readonly scopes:readonly string[];
  readonly expiresAt:number;
}
interface RefreshRow {
  token_hash:string; family_id:string; generation:number; principal_id:string;
  client_id:string; resource:string; scopes_json:string; issued_at:number;
  expires_at:number; consumed_at:number|null; revoked_at:number|null;
}
function accessInsert(db:Database.Database, grant:OAuthGrantRecord):void{
  db.prepare(`INSERT INTO oauth_access_tokens
    (token_hash,principal_id,client_id,resource,scopes_json,family_id,issued_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(grant.tokenHash,grant.principalId,grant.clientId,grant.resource,
      JSON.stringify(grant.scopes),grant.familyId,grant.issuedAt,grant.accessExpiresAt);
}
function refreshInsert(db:Database.Database,grant:OAuthGrantRecord,hash:string):void{
  db.prepare(`INSERT INTO oauth_refresh_tokens
    (token_hash,family_id,generation,principal_id,client_id,resource,scopes_json,issued_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(hash,grant.familyId,grant.generation,
      grant.principalId,grant.clientId,grant.resource,JSON.stringify(grant.scopes),
      grant.issuedAt,grant.refreshExpiresAt);
}
export function persistOAuthGrant(grant:OAuthGrantRecord,refreshHash:string):void{
  withAgentDatabase(db=>db.transaction(()=>{
    accessInsert(db,grant);refreshInsert(db,grant,refreshHash);
  })());
}
export function validateOAuthAccess(hash:string,resource:string,now:number):OAuthAccessClaims|null{
  return withAgentDatabase(db=>{
    const row=db.prepare(`SELECT principal_id,client_id,resource,scopes_json,expires_at
       FROM oauth_access_tokens WHERE token_hash=? AND revoked_at IS NULL
         AND expires_at>? AND resource=? AND NOT EXISTS
       (SELECT 1 FROM oauth_revoked_families WHERE family_id=oauth_access_tokens.family_id)`)
      .get(hash,now,resource) as {
        principal_id:string;client_id:string;resource:string;scopes_json:string;expires_at:number
      }|undefined;
    return row?{principalId:row.principal_id,clientId:row.client_id,resource:row.resource,
      scopes:JSON.parse(row.scopes_json) as string[],expiresAt:row.expires_at}:null;
  });
}
export type RotateResult={kind:"rotated";grant:OAuthGrantRecord}|
  {kind:"replay";familyId:string}|{kind:"invalid"};
export function rotateOAuthRefresh(input:{
  readonly oldHash:string; readonly newAccessHash:string;readonly newRefreshHash:string;
  readonly clientId?:string;readonly resource:string;readonly now:number;
  readonly accessTtlMs:number;readonly refreshTtlMs:number;
}):RotateResult {
  return withAgentDatabase(db=>db.transaction(()=>{
    const old=db.prepare("SELECT * FROM oauth_refresh_tokens WHERE token_hash=?").get(input.oldHash) as RefreshRow|undefined;
    if(!old||old.resource!==input.resource||
       (input.clientId!==undefined&&old.client_id!==input.clientId))return {kind:"invalid" as const};
    if(old.consumed_at!==null){
      db.prepare("INSERT OR IGNORE INTO oauth_revoked_families(family_id,revoked_at) VALUES (?,?)")
        .run(old.family_id,input.now);
      db.prepare("UPDATE oauth_access_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
        .run(input.now,old.family_id);
      db.prepare("UPDATE oauth_refresh_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
        .run(input.now,old.family_id);
      return {kind:"replay" as const,familyId:old.family_id};
    }
    const revoked=db.prepare("SELECT 1 FROM oauth_revoked_families WHERE family_id=?").get(old.family_id);
    if(revoked||old.revoked_at!==null||old.expires_at<=input.now)return {kind:"invalid" as const};
    const consumed=db.prepare(`UPDATE oauth_refresh_tokens SET consumed_at=?,rotated_to_hash=?
      WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL`)
      .run(input.now,input.newRefreshHash,input.oldHash);
    if(consumed.changes!==1)throw new Error("oauth_refresh_concurrent_update");
    const grant:OAuthGrantRecord={
      tokenHash:input.newAccessHash,principalId:old.principal_id,clientId:old.client_id,
      resource:old.resource,scopes:JSON.parse(old.scopes_json) as string[],familyId:old.family_id,
      generation:old.generation+1,issuedAt:input.now,
      accessExpiresAt:input.now+input.accessTtlMs,
      refreshExpiresAt:Math.min(old.expires_at,input.now+input.refreshTtlMs)
    };
    accessInsert(db,grant);refreshInsert(db,grant,input.newRefreshHash);
    return {kind:"rotated" as const,grant};
  })());
}
export function revokeOAuthAccess(hash:string,now:number):void{
  withAgentDatabase(db=>db.transaction(()=>{
    const row=db.prepare("SELECT family_id FROM oauth_access_tokens WHERE token_hash=?").get(hash) as {family_id:string}|undefined;
    if(!row)return;
    db.prepare("INSERT OR IGNORE INTO oauth_revoked_families(family_id,revoked_at) VALUES (?,?)")
      .run(row.family_id,now);
    db.prepare("UPDATE oauth_access_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
      .run(now,row.family_id);
    db.prepare("UPDATE oauth_refresh_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
      .run(now,row.family_id);
  })());
}
export function cleanupOAuthExpired(now:number):void{
  withAgentDatabase(db=>db.transaction(()=>{
    db.prepare("DELETE FROM oauth_access_tokens WHERE expires_at<?").run(now);
    // Keep consumed/revoked refresh entries until their entire family expires,
    // so replay cannot be accepted merely because the access token expired.
    db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at<?").run(now);
    db.prepare(`DELETE FROM oauth_revoked_families WHERE NOT EXISTS
      (SELECT 1 FROM oauth_refresh_tokens r WHERE r.family_id=oauth_revoked_families.family_id)`).run();
  })());
}
export function issueOAuthFamilyId():string{return randomUUID();}
export function registerOAuthClient(clientId:string,redirectUris:readonly string[],now:number):void{
  withAgentDatabase(db=>{
    const count=(db.prepare("SELECT COUNT(*) AS count FROM oauth_registered_clients").get() as {count:number}).count;
    if(count>=256)throw new Error("oauth_client_registration_limit");
    db.prepare("INSERT INTO oauth_registered_clients(client_id,redirect_uris_json,registered_at) VALUES (?,?,?)")
      .run(clientId,JSON.stringify(redirectUris),now);
  });
}
export function verifyOAuthClientRedirect(clientId:string,redirectUri:string):boolean{
  return withAgentDatabase(db=>{
    const row=db.prepare("SELECT redirect_uris_json FROM oauth_registered_clients WHERE client_id=?")
      .get(clientId) as {redirect_uris_json:string}|undefined;
    return row!==undefined&&(JSON.parse(row.redirect_uris_json) as string[]).includes(redirectUri);
  });
}
