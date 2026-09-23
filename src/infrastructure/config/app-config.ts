import path from "node:path";
import { readHttpBootstrapSecret, readHttpSecurityConfig, type HttpServerSettings } from "./legacy-http-server.js";

export interface AppConfig {
  readonly environment: "development" | "test" | "production";
  readonly http: HttpServerSettings;
  readonly bootstrapToken: string | undefined;
  readonly bootstrapTokenFile: string;
}

function environment(env: Readonly<Record<string,string|undefined>>): AppConfig["environment"] {
  const value=env.HOOSHIX_ENV??env.NODE_ENV??"development";
  if(value!=="development"&&value!=="test"&&value!=="production") throw new Error("invalid HOOSHIX_ENV");
  return value;
}

export function loadAppConfig(env:Readonly<Record<string,string|undefined>>=process.env,cwd=process.cwd()):AppConfig {
  // Security-sensitive stale names fail visibly; the legacy reader owns the migration messages.
  const bootstrapToken=readHttpBootstrapSecret(env);
  const http=readHttpSecurityConfig(env);
  const bootstrapTokenFile=env.HOOSHIX_BOOTSTRAP_TOKEN_FILE?.trim()||path.join(cwd,".token");
  return Object.freeze({environment:environment(env),http,bootstrapToken,bootstrapTokenFile});
}
