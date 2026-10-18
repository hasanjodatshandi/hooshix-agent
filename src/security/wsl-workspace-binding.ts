import { withAgentDatabase } from "../core/memory/database/index.js";
import { parseWSLWorkspaceURI, type WSLWorkspaceURI } from "./wsl-workspace-uri.js";

export interface WSLWorkspaceBinding extends WSLWorkspaceURI {
 ownerWindowsRoot: string;
}
export function getWSLWorkspaceBinding(uri:string): WSLWorkspaceBinding | null {
 const parsed=parseWSLWorkspaceURI(uri);
 if(!parsed)return null;
 return withAgentDatabase((db)=>{
  const row=db.prepare("SELECT windows_owner_anchor AS ownerWindowsRoot, distro, linux_root AS linuxRoot FROM wsl_workspace_bindings WHERE workspace_uri=?")
   .get(parsed.uri) as {ownerWindowsRoot:string;distro:string;linuxRoot:string}|undefined;
  if(!row || row.distro!==parsed.distro || row.linuxRoot!==parsed.linuxRoot)return null;
  return {...parsed,ownerWindowsRoot:row.ownerWindowsRoot};
 });
}
export function persistWSLWorkspaceBinding(binding:WSLWorkspaceBinding):void{
 const parsed=parseWSLWorkspaceURI(binding.uri);
 if(!parsed||parsed.distro!==binding.distro||parsed.linuxRoot!==binding.linuxRoot)
  throw new Error("wsl_binding_identity_mismatch");
 withAgentDatabase((db)=>db.transaction(()=>{
  const existing=db.prepare("SELECT windows_owner_anchor AS anchor FROM wsl_workspace_bindings WHERE workspace_uri=?").get(binding.uri) as {anchor:string}|undefined;
  if(existing && existing.anchor.toLowerCase()!==binding.ownerWindowsRoot.toLowerCase())
   throw new Error("wsl_workspace_owner_change_requires_revocation");
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO workspace_roots(id,path,normalized_path,created_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(normalized_path) DO UPDATE SET updated_at=excluded.updated_at`)
    .run(binding.uri,binding.uri,binding.uri,now,now);
  db.prepare(`INSERT INTO wsl_workspace_bindings(workspace_uri,windows_owner_anchor,distro,linux_root,created_at)
   VALUES (?,?,?,?,?) ON CONFLICT(workspace_uri) DO NOTHING`)
   .run(binding.uri,binding.ownerWindowsRoot,binding.distro,binding.linuxRoot,now);
 })());
}
export function revokeWSLWorkspaceBinding(uri:string):void{
 withAgentDatabase((db)=>db.transaction(()=>{
  db.prepare("DELETE FROM wsl_workspace_bindings WHERE workspace_uri=?").run(uri);
  db.prepare("DELETE FROM workspace_roots WHERE normalized_path=?").run(uri);
 })());
}