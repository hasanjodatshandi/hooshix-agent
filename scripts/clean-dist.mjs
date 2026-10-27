#!/usr/bin/env node
// Clean only the compiler-generated repository dist directory before tsc.
// Refuse symlink redirection and never touch Program Files or operator data.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dest=path.join(repo,"dist");
try{
  const info=fs.lstatSync(dest);
  if(info.isSymbolicLink()||!info.isDirectory()) throw new Error("unsafe dist target");
  if(fs.realpathSync(dest)!==dest) throw new Error("dist path is redirected");
  fs.rmSync(dest,{recursive:true,force:false});
}catch(err){
  if(err?.code!=="ENOENT")throw err;
}
