import {escapeHTML} from "./pages.js";

export type WindowsProjectRow = {
  path:string;
  active:boolean;
  persistent:boolean;
  exists:boolean;
  git:"ready"|"not_repository"|"untrusted_owner"|"unavailable"|"missing";
};

// All text from the filesystem and operator configuration is HTML escaped.
// The only scripts run on the client and never submit workspace mutations:
// adding a root requires the existing governed MCP Task approval flow.
export function windowsSettingsPage(input:{
  publicBaseUrl:string;port:number;projects:WindowsProjectRow[];
}):string{
 const esc=escapeHTML;
 const rows=input.projects.map(root=>{
  const git={
   ready:"Git detected",not_repository:"Not a Git repository",
   untrusted_owner:"Git ownership requires approval",unavailable:"Git not available",
   missing:"Directory unavailable"
  }[root.git];
  return `<article class="project">
   <div class="row"><div class="path">${esc(root.path)}</div><div class="chip">${esc(git)}</div></div>
   <p class="meta">${root.exists?"Windows directory available":"Directory missing"} · ${root.active?"Active root":"Approved project"} · ${root.persistent?"Saved":"Session-only"}</p>
   <button class="ghost" type="button" data-project="${esc(root.path)}">Copy open_project request</button>
  </article>`;
 }).join("");
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>HooshiX MCP | Windows settings</title>
<style>
:root{color-scheme:dark;font-family:Segoe UI,system-ui,Arial,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e5edf9}
.layout{display:grid;grid-template-columns:235px 1fr;min-height:100vh}
aside{border-right:1px solid #273348;padding:30px 22px;background:#10192a}
.logo{font-weight:750;font-size:20px;letter-spacing:-.5px}.logo span{color:#71b9ff}
.mini{color:#9facbf;font-size:12px;margin-top:9px}
nav{display:grid;gap:6px;margin-top:35px}nav a{color:#b6c5da;text-decoration:none;border-radius:9px;padding:10px}
nav a:hover,nav a.current{background:#1d314c;color:white}
main{max-width:960px;padding:42px 48px;width:100%}
h1{font-size:28px;margin:0 0 8px;letter-spacing:-.7px}h2{font-size:19px;margin:0 0 15px}
p{line-height:1.6}.lead,.meta{color:#a3b2c8;font-size:14px}
.section{padding:22px;border-radius:13px;background:#151f31;border:1px solid #303e54;margin:24px 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.stat{padding:16px;background:#101a2a;border:1px solid #344157;border-radius:10px;overflow-wrap:anywhere}
.stat .name{color:#9db0c9;font-size:12px}.stat .value{font-weight:600;margin-top:8px}
.project{border-top:1px solid #303e54;padding:17px 0}
.project:last-child{padding-bottom:0}.row{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.path{font-family:Consolas,monospace;overflow-wrap:anywhere;font-size:14px}
.chip{font-size:12px;padding:5px 9px;border-radius:12px;background:#203c4c;color:#b9f1da}
button{cursor:pointer;background:#5baaff;color:#0d1420;font-weight:600;border:0;border-radius:8px;padding:11px 15px;font:inherit}
button:hover{filter:brightness(1.09)}button.ghost{background:#233247;color:#ddeaff;font-size:12px;padding:7px 10px}
input{padding:12px 14px;background:#0b1422;border:1px solid #3c4d62;color:#eaf0f8;border-radius:7px;width:100%;font:inherit}
.field{display:flex;gap:10px}.field input{flex:1}
.note{font-size:13px;color:#9fb0c8}
.toast{min-height:22px;color:#9ae5b6;margin-top:10px}
@media(max-width:770px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #273348;padding:16px}nav{display:flex;margin-top:12px}main{padding:24px 16px}.grid{grid-template-columns:1fr}.field{flex-direction:column}}
</style></head><body><div class="layout">
<aside><div class="logo">HooshiX <span>MCP</span></div><div class="mini">Windows edition · Free · Apache-2.0</div>
<nav><a href="#general" class="current">Overview</a><a href="#projects">Windows projects</a><a href="#git">Git integration</a><a href="/docs">Tool reference</a><a href="/dashboard">Diagnostics</a></nav></aside>
<main><h1>Settings</h1><p class="lead">A simple overview of your local Windows connector. Project access remains controlled by explicit MCP task approval.</p>
<section class="section" id="general"><h2>Connection</h2>
<div class="grid">
<div class="stat"><div class="name">Edition</div><div class="value">Free (Apache-2.0)</div></div>
<div class="stat"><div class="name">Service port</div><div class="value">${esc(String(input.port))}</div></div>
<div class="stat"><div class="name">Approved project roots</div><div class="value">${input.projects.length}</div></div>
</div><p class="meta">Configured public URL: <code>${esc(input.publicBaseUrl)}</code></p>
<p class="note">Connection and security settings are intentionally not editable over the network. Reconfiguring the Windows service requires local administrative access.</p></section>
<section class="section" id="projects"><h2>Windows projects</h2>
<p class="lead">Choose an approved folder to prepare an <code>open_project</code> request. This does not grant additional filesystem access.</p>
${rows||'<p class="lead">No approved Windows projects are available yet.</p>'}
<h2 style="margin-top:24px">Request access to another Windows folder</h2>
<div class="field"><input id="folder" aria-label="Windows folder" placeholder="D:\\Projects\\my-app" spellcheck="false">
<button id="create" type="button">Copy approval request</button></div>
<p class="note">Access requests require your explicit approval in ChatGPT. The website cannot approve its own projects.</p>
<div id="toast" role="status" class="toast"></div></section>
<section class="section" id="git"><h2>Automatic Git detection</h2>
<p class="lead">Each approved folder is checked with a read-only Git probe under the Windows service identity. Unknown owners are not automatically trusted.</p>
<p class="note">Use a Git repository on a local Windows drive. A Git installation must be available on the service account's PATH.</p></section>
</main></div>
<script>
(function(){
 const toast=document.getElementById('toast');
 async function copy(value){try{await navigator.clipboard.writeText(value);toast.textContent='Request copied';}
 catch{toast.textContent='Copy unavailable in this browser. Use the project path manually.'}}
 document.querySelectorAll('[data-project]').forEach(b=>b.addEventListener('click',()=>copy('open_project '+JSON.stringify({path:b.dataset.project}))));
 document.getElementById('create').addEventListener('click',()=>{
  const raw=document.getElementById('folder').value.trim();
  if(!/^[a-z]:[\\/]/i.test(raw)||raw.includes('..')||raw.toLowerCase().startsWith('wsl:')){
   toast.textContent='Enter a full local Windows drive path (for example D:\\Projects\\app).';return;
  }
  const req={title:'Allow Windows project folder',steps:[{action:'Allow '+raw,tool:'add_workspace_roots',arguments:{paths:[raw]}}]};
  copy('Please create this HooshiX Task and ask for my approval before executing it: '+JSON.stringify(req));
 });
})();
</script></body></html>`;
}
