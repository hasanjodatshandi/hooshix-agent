import type { PrincipalId } from "../shared/ids.js";
import type { PermissionLevel } from "../tool/tool-descriptor.js";
export interface Principal { readonly id: PrincipalId; readonly permission: PermissionLevel; readonly scopes: readonly string[]; }
