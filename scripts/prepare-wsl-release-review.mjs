#!/usr/bin/env node
/**
 * Prepare a review-only native-WSL release source snapshot.
 *
 * Does not change the real .git index, refs, worktree, services or WSL roots.
 * Immutable commit provenance is NOT claimed: modified/untracked files are
 * overlaid on an exported HEAD tree, and their digests are recorded.
 *
 * Usage:
 *  node scripts/prepare-wsl-release-review.mjs --out <path-under-deploy/windows/build>
 *  node scripts/prepare-wsl-release-review.mjs --verify <review-directory>
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const buildRoot=path.join(repo,"deploy","windows","build");
function git(...args){
 return execFileSync("git",args,{cwd:repo,maxBuffer:64*1024*1024,encoding:"buffer",stdio:["ignore","pipe","pipe"]});
}
function sha(b){return crypto.createHash("sha256").update(b).digest("hex");}
function boundedPath(p){
 const resolved=path.resolve(p);
 const relative=path.relative(buildRoot,resolved);
 if(!relative || relative===".." || relative.startsWith(".."+path.sep)||path.isAbsolute(relative))
  throw new Error("review output must be an unused directory beneath deploy/windows/build");
 return resolved;
}
function status(){
 const values=git("status","--porcelain=v1","-z","--untracked-files=all").toString("utf8").split("\0");
 const output=[];
 for(let i=0;i<values.length;i++){
  const item=values[i];
  if(!item)continue;
  const status=item.slice(0,2),name=item.slice(3);
  if(status.includes("R")||status.includes("C"))i++;
  if(status[0]!==" " && status[0]!=="?")throw new Error("staged changes or renames require explicit review");
  output.push({status,path:name});
 }
 return output;
}
function group(name){
 const file=name.replaceAll("\\","/");
 if(/^(?:%SystemDrive%|%[^/]+%|[a-z]:)\//i.test(file)||
   file.startsWith("../")||file.startsWith("//"))
  return "pseudo_system_quarantine";
 if(/^(?:deploy\/windows\/internal\/(?:wslfs|gitworker)\/|deploy\/windows\/cmd\/hooshix-(?:git-worker|wsl-fs-broker)\/|src\/security\/wsl-|tests\/wsl-|scripts\/(?:enroll-wsl|preflight-wsl))/i.test(file))
  return "native_wsl";
 if(/^(?:src\/|deploy\/windows\/|scripts\/|\.github\/|package\.json|pnpm-lock\.yaml|tests\/)/i.test(file))
  return "cross_cutting_requires_review";
 return "documentation_or_other_hold";
}
function safeSegments(relative){
 if(!relative || relative.includes("\0")||relative.includes("\\")||path.isAbsolute(relative)||
   relative.split("/").some(x=>!x||x==="."||x==="..") || relative.startsWith("/"))
  throw new Error("unsafe review source-relative path");
 return relative.split("/");
}
function readSource(relative){
 const segments=safeSegments(relative);
 let parent=repo;
 for(let i=0;i<segments.length;i++){
  parent=path.join(parent,segments[i]);
  const stat=fs.lstatSync(parent);
  if(stat.isSymbolicLink())throw new Error("symbolic links are not allowed as source overlay paths");
  if(i===segments.length-1){if(!stat.isFile())throw new Error("source overlay must be a regular file");}
  else if(!stat.isDirectory())throw new Error("source overlay parent is not a directory");
 }
 return fs.readFileSync(parent);
}
function ensureDestination(relative,sourceDir){
 const parts=safeSegments(relative);
 let current=sourceDir;
 for(const part of parts.slice(0,-1)){
  current=path.join(current,part);
  if(fs.existsSync(current)){
   if(!fs.lstatSync(current).isDirectory())throw new Error("review destination directory unexpectedly not a directory");
  }else{fs.mkdirSync(current);}
 }
 const dest=path.join(sourceDir,...parts);
 if(fs.existsSync(dest)&&!fs.lstatSync(dest).isFile())
  throw new Error("review destination is not a regular file");
 return dest;
}
function verifyReview(dir){
 const location=boundedPath(dir);
 const manifest=JSON.parse(fs.readFileSync(path.join(location,"review-manifest.json"),"utf8"));
 if(manifest.kind!=="hooshix_wsl_review_only_v1" || manifest.releaseReady!==false)
  throw new Error("incorrect review manifest type or release status");
 let count=0;
 for(const item of manifest.includedOverlays){
  const rel=item.path, target=path.join(location,"source",...safeSegments(rel));
  if(!fs.existsSync(target)||!fs.lstatSync(target).isFile() ||
    sha(fs.readFileSync(target))!==item.sha256)
   throw new Error("review overlay checksum mismatch: "+rel);
  count++;
 }
 for(const item of manifest.heldOut){
  if(item.path.startsWith("%SystemDrive%/")){
   if(fs.existsSync(path.join(location,"source",...safeSegments(item.path))))
    throw new Error("quarantined pseudo-system path entered candidate source");
  }
 }
 const sealed=path.join(location,"review-source.tar.gz");
 if(!fs.existsSync(sealed)||sha(fs.readFileSync(sealed))!==manifest.sourceArchiveSHA256)
  throw new Error("sealed review source archive checksum mismatch");
 const patch=path.join(location,"tracked-changes-review.patch");
 if(!fs.existsSync(patch)||sha(fs.readFileSync(patch))!==manifest.trackedPatchSHA256)
  throw new Error("review tracked patch checksum mismatch");
 const canonical=JSON.stringify({baseCommit:manifest.baseCommit,
  baseTree:manifest.baseTree,overlays:manifest.includedOverlays});
 if(sha(Buffer.from(canonical))!==manifest.reviewFingerprint)
  throw new Error("review fingerprint mismatch");
 return {kind:"hooshix_review_snapshot_verification",verdict:"PASS",
  releaseReady:false,baseCommit:manifest.baseCommit,reviewFingerprint:manifest.reviewFingerprint,
  verifiedOverlays:count,heldOut:manifest.heldOut.length};
}
function main(){
 const [mode,argument,...extra]=process.argv.slice(2);
 if(extra.length||!["--out","--verify"].includes(mode)||!argument)
  throw new Error("usage: prepare-wsl-release-review.mjs --out|--verify <path>");
 if(mode==="--verify"){console.log(JSON.stringify(verifyReview(argument),null,2));return;}
 const target=boundedPath(argument);
 if(fs.existsSync(target))throw new Error("refusing to overwrite existing review candidate");
 const entries=status();
 const baseCommit=git("rev-parse","HEAD").toString("utf8").trim();
 const baseTree=git("rev-parse","HEAD^{tree}").toString("utf8").trim();
 const reviewed=[],heldOut=[];
 for(const entry of entries){
  const classification=group(entry.path);
  const result={...entry,classification};
  if(classification==="native_wsl"||classification==="cross_cutting_requires_review")reviewed.push(result);
  else heldOut.push(result);
 }
 fs.mkdirSync(target,{recursive:false});
 try{
  const archive=path.join(target,"baseline-head.tar");
  const sourceDir=path.join(target,"source");
  fs.mkdirSync(sourceDir);
  execFileSync("git",["archive","--format=tar","--output="+archive,baseCommit],
    {cwd:repo,stdio:["ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  execFileSync("tar",["-xf",archive,"-C",sourceDir],
    {cwd:repo,stdio:["ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  fs.unlinkSync(archive);
  const overlays=[];
  for(const item of reviewed.sort((a,b)=>a.path.localeCompare(b.path,"en"))){
   const content=readSource(item.path);
   const dest=ensureDestination(item.path,sourceDir);
   fs.writeFileSync(dest,content,{flag:"w"});
   if(sha(fs.readFileSync(dest))!==sha(content))throw new Error("overlay write verification failed");
   overlays.push({...item,bytes:content.length,sha256:sha(content)});
  }
  // A concurrent user edit must abort the snapshot rather than silently
  // mixing two different live source states.
  const after=status();
  if(JSON.stringify(entries)!==JSON.stringify(after))
   throw new Error("worktree status changed while creating review snapshot");
  for(const item of overlays){
   if(sha(readSource(item.path))!==item.sha256)
    throw new Error("worktree source content changed during snapshot: "+item.path);
  }
  const trackedDiff=git("diff","--binary","--no-ext-diff","HEAD","--");
  fs.writeFileSync(path.join(target,"tracked-changes-review.patch"),trackedDiff);
  const sourceArchive=path.join(target,"review-source.tar.gz");
  execFileSync("tar",["-czf",sourceArchive,"-C",target,"source"],
    {cwd:repo,stdio:["ignore","pipe","pipe"],maxBuffer:4*1024*1024});
  const sourceArchiveSHA256=sha(fs.readFileSync(sourceArchive));
  const canonical=JSON.stringify({baseCommit,baseTree,overlays});
  const manifest={
   kind:"hooshix_wsl_review_only_v1",
   releaseReady:false,productionApproved:false,
   explanation:"Review-only reconstructed source; uncommitted overlays have not been independently reviewed, signed or committed.",
   baseCommit,baseTree,reviewFingerprint:sha(Buffer.from(canonical)),
   sourceRoot:"source",sourceArchive:"review-source.tar.gz",
   sourceArchiveBytes:fs.statSync(sourceArchive).size,sourceArchiveSHA256,
   includedOverlays:overlays,heldOut:heldOut.sort((a,b)=>a.path.localeCompare(b.path,"en")),
   trackedPatchFile:"tracked-changes-review.patch",
   trackedPatchSHA256:sha(trackedDiff),
   groupCounts:{native_wsl:reviewed.filter(x=>x.classification==="native_wsl").length,
    cross_cutting_requires_review:reviewed.filter(x=>x.classification==="cross_cutting_requires_review").length,
    held_out_documentation:heldOut.filter(x=>x.classification==="documentation_or_other_hold").length,
    pseudo_system_quarantine:heldOut.filter(x=>x.classification==="pseudo_system_quarantine").length},
   exclusionsNeedReview:true,
   nextGates:["Review all cross-cutting modifications and held-out documentation",
    "Investigate quarantined pseudo-system files without deleting them",
    "Produce an explicitly reviewed immutable source commit",
    "Build and retest an installer from that exact commit",
    "Independently verify service backup, install and rollback"],
  };
  fs.writeFileSync(path.join(target,"review-manifest.json"),
    JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
  const notes=[
    "# Native WSL release source: review-only snapshot",
    "",
    "Production status: **NO_GO / NOT APPROVED**",
    "",
    "Base source: `"+baseCommit+"`",
    "Review fingerprint: `"+manifest.reviewFingerprint+"`",
    "Source archive SHA-256: `"+sourceArchiveSHA256+"`",
    "",
    "This snapshot was assembled without staging or committing the original Git worktree.",
    "Runtime files shared with earlier unrelated changes are included for compiler compatibility, **not approved**.",
    "Review every tracked change in `tracked-changes-review.patch` and every untracked SHA-256 in `review-manifest.json`.",
    "The four pseudo-system `%SystemDrive%` database files and ten other documentation files are deliberately held out.",
    "No credentials, service configuration, WSL enrollment, production installation, or rollback was changed.",
    "",
    "Next: security/code review; verify release provenance; create an explicit reviewed commit; rebuild and test; independent backup/rollback approval.",
  ];
  fs.writeFileSync(path.join(target,"REVIEW_NOTES.md"),notes.join("\n")+"\n",{flag:"wx"});
  const verification=verifyReview(target);
  console.log(JSON.stringify({snapshot:target,manifest:path.join(target,"review-manifest.json"),
   patch:path.join(target,"tracked-changes-review.patch"),source:path.join(target,"source"),
   ...verification,groups:manifest.groupCounts},null,2));
 }catch(e){
  // Deliberately retain any partial review snapshot for incident analysis.
  // Do not delete anything from the user's source tree or the failed output.
  throw e;
 }
}
try{main();}catch(e){console.error("WSL_RELEASE_REVIEW_ERROR: "+String(e?.message??e));process.exitCode=1;}
