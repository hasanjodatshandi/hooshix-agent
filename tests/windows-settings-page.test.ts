import {describe,expect,it} from "vitest";
import {windowsSettingsPage} from "../src/mcp/windows-settings-page.js";

describe("Windows-only operator settings page",()=>{
 it("shows free edition, Windows roots and automatic Git results",()=>{
  const html=windowsSettingsPage({publicBaseUrl:"https://mcp.example.test",port:3001,projects:[
   {path:"D:\\Work\\Client",active:true,persistent:true,exists:true,git:"ready"},
   {path:"C:\\Sources\\Another",active:false,persistent:true,exists:true,git:"not_repository"},
  ]});
  expect(html).toContain("Free (Apache-2.0)");
  expect(html).toContain("Git detected");
  expect(html).toContain("Not a Git repository");
  expect(html).toContain("Copy approval request");
  expect(html).toContain("open_project");
  expect(html).toContain("D:\\Work\\Client");
 });
 it("escapes every filesystem path and remote URL without injecting HTML",()=>{
  const html=windowsSettingsPage({publicBaseUrl:'https://example.test/?p=<script>alert(1)</script>',port:3001,
   projects:[{path:'C:\\tmp\\<img src=x onerror=alert(1)>',active:false,persistent:true,exists:true,git:"untrusted_owner"}]});
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;img");
  expect(html).toContain("Git ownership requires approval");
 });
});
