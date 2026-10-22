import {describe,it,expect} from "vitest";
import {parseWSLWorkspaceURI,isWSLWorkspaceURI,wslRelativePath} from "../src/security/wsl-workspace-uri.js";
describe("WSL workspace identifiers are not Windows filesystem roots",()=>{
 const uri="wsl://Ubuntu/home/coder/workspace/Hooshix";
 it("recognizes canonical URI and ordinary WSL UNC",()=>{
  expect(parseWSLWorkspaceURI(uri)).toMatchObject({uri,distro:"Ubuntu",linuxRoot:"/home/coder/workspace/Hooshix",label:"Hooshix"});
  const slash=String.fromCharCode(92);
  const unc=slash+slash+["wsl.localhost","Ubuntu","home","coder","workspace","Hooshix"].join(slash);
  expect(isWSLWorkspaceURI(unc)).toBe(true);
  expect(parseWSLWorkspaceURI(unc)?.uri).toBe(uri);
 });
 it("refuses arbitrary UNC/network shares and Linux path traversal",()=>{
  expect(parseWSLWorkspaceURI("D:/repo")).toBeNull();
  for(const bad of ["wsl://Ubuntu/etc/../root","wsl://Ubuntu//etc","wsl://Ubuntu/home/%2e%2e",
   "wsl://-bad/home","wsl://Ubuntu/home/a\\b","wsl://Ubuntu/home/a/./b"]){
   expect(()=>parseWSLWorkspaceURI(bad)).toThrow();
  }
  for(const bad of ["../etc","a/../../b","/etc/passwd","a\\b","a//b","a/./b"]){
   expect(()=>wslRelativePath(bad)).toThrow();
  }
  expect(wslRelativePath("src/server.ts")).toBe("src/server.ts");
 });
});
