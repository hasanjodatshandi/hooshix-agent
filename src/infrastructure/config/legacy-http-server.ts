/** R5 HTTP transport security configuration. Local loopback may use HTTP;
 * external binds require an explicitly configured HTTPS public origin. */
export interface HttpServerSettings{
  readonly port:number;
  readonly host:string;
  readonly publicBaseUrl:string;
  readonly resource:string;
  readonly allowedOrigins:readonly string[];
}
export function readLegacyHttpServerSettings(
  env:Readonly<Record<string,string|undefined>>=process.env
):{port:number;publicBaseUrl:string}{
  const c=readHttpSecurityConfig(env);
  return {port:c.port,publicBaseUrl:c.publicBaseUrl};
}
export function readLegacyHttpAccessToken(
  _env:Readonly<Record<string,string|undefined>>=process.env
):undefined{return undefined;}
export function readHttpBootstrapSecret(
  env:Readonly<Record<string,string|undefined>>=process.env
):string|undefined{
  if(env.MCP_ACCESS_TOKEN!==undefined)
    throw new Error("MCP_ACCESS_TOKEN is deprecated and cannot be used as a client bearer; use HOOSHIX_BOOTSTRAP_TOKEN");
  if(env.MCP_API_KEY!==undefined)
    throw new Error("MCP_API_KEY is unsupported; migrate to HOOSHIX_BOOTSTRAP_TOKEN");
  return env.HOOSHIX_BOOTSTRAP_TOKEN||undefined;
}
export function readHttpSecurityConfig(
  env:Readonly<Record<string,string|undefined>>=process.env
):HttpServerSettings{
  if(env.MCP_ACCESS_TOKEN!==undefined||env.MCP_API_KEY!==undefined)
    readHttpBootstrapSecret(env);
  const port=Number(env.HOOSHIX_HTTP_PORT??env.MCP_PORT??"3001");
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error("invalid MCP_PORT");
  const host=env.HOOSHIX_HTTP_HOST??env.MCP_BIND_HOST??"127.0.0.1";
  const local=["127.0.0.1","localhost","::1"].includes(host);
  const raw=(env.HOOSHIX_PUBLIC_BASE_URL??env.MCP_PUBLIC_BASE_URL)?.trim()??"";
  if(!local&&!raw)throw new Error("MCP_PUBLIC_BASE_URL required for external HTTP binding");
  let publicBaseUrl="";
  if(raw){
    const parsed=new URL(raw);
    if(parsed.username||parsed.password||parsed.hash||parsed.search||parsed.pathname!=="/"||
       (parsed.protocol!=="https:"&&!(local&&parsed.protocol==="http:"))||
       (!local&&parsed.protocol!=="https:"))
      throw new Error("MCP_PUBLIC_BASE_URL must be an exact trusted HTTPS origin");
    publicBaseUrl=parsed.origin;
  }else{
    publicBaseUrl=`http://127.0.0.1:${port}`;
  }
  const allowedOrigins=(env.HOOSHIX_ALLOWED_ORIGINS??env.MCP_ALLOWED_ORIGINS??"").split(",").map(s=>s.trim()).filter(Boolean);
  for(const origin of allowedOrigins){
    const url=new URL(origin);
    if(url.origin!==origin||url.username||url.password||url.protocol!=="https:"&&
       !(local&&url.protocol==="http:"))
      throw new Error("MCP_ALLOWED_ORIGINS requires explicit valid origins");
  }
  return {port,host,publicBaseUrl,resource:publicBaseUrl+"/mcp",allowedOrigins};
}
