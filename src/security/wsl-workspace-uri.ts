import path from "node:path";

// WSL roots are *virtual provider identities*; never pass them through win32
// path.resolve, Windows fs.realpath, or Windows UNC filesystem access.
const WSL_URI = /^wsl:\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,79})(\/[^?#]*)$/;
export interface WSLWorkspaceURI {
  uri: string;
  distro: string;
  linuxRoot: string;
  label: string;
}
export function parseWSLWorkspaceURI(value: string): WSLWorkspaceURI | null {
  // Normalize only the two standard WSL UNC providers; arbitrary network
  // shares are never treated as WSL directories or auto-granted.
  const slash=String.fromCharCode(92);
  let canonical=value;
  if(value.startsWith(slash+slash)){
    const [host,distro,...folders]=value.slice(2).split(slash);
    if(host?.toLowerCase()==="wsl.localhost"||host?.toLowerCase()==="wsl$"){
      if(!distro||!folders.length)throw new Error("invalid_wsl_workspace_uri");
      canonical="wsl://"+distro+"/"+folders.join("/");
    }
  }
  if (!canonical.startsWith("wsl://")) return null;
  const match=WSL_URI.exec(canonical);
  if(!match)throw new Error("invalid_wsl_workspace_uri");
  const distro=match[1];
  const linuxRoot=match[2];
  if(distro==="."||distro===".."||distro.startsWith("-")||
     linuxRoot.startsWith("//")||linuxRoot!==path.posix.normalize(linuxRoot)||
     /[%\\\0\r\n]/.test(linuxRoot)||linuxRoot.split("/").some(p=>p==="."||p===".."))
    throw new Error("invalid_wsl_workspace_uri");
  if(linuxRoot.length>2048)throw new Error("invalid_wsl_workspace_uri");
  return {uri:canonical,distro,linuxRoot,label:path.posix.basename(linuxRoot)};
}
export function isWSLWorkspaceURI(value: string): boolean {
  if(value.startsWith("wsl://"))return true;
  const slash=String.fromCharCode(92);
  return value.startsWith(slash+slash) && ["wsl.localhost","wsl$"].includes(value.slice(2).split(slash)[0]?.toLowerCase()??"");
}
export function wslRelativePath(input:string):string{
  const pathValue=input.replaceAll("\\","/"); // Windows separator is NEVER accepted for WSL
  if(pathValue!==input||input.startsWith("/")||input.includes(":")||input.includes("\0")||
     input.length>2048)throw new Error("wsl_workspace_path_invalid");
  if(input==="."||input==="")return ".";
  const components=input.split("/");
  if(components.some(part=>part===""||part==="."||part===".."))throw new Error("wsl_workspace_path_invalid");
  return input;
}
