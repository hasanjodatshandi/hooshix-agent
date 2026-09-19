import type { PrincipalId } from "../../../domain/shared/ids.js";
/** R1 shape only; actual issuance/rotation/replay and HTTP binding belong to R5. */
export interface IssueAuthorizationCodeUseCase { execute(input: { readonly principalId: PrincipalId; readonly clientId: string; readonly resource: string; readonly codeChallenge: string }): Promise<{ readonly code: string }>; }
export interface ExchangeAuthorizationCodeUseCase { execute(input: { readonly code: string; readonly verifier: string; readonly resource: string }): Promise<{ readonly accessToken: string; readonly refreshToken: string }>; }
export interface RefreshTokenUseCase { execute(refreshToken: string): Promise<{ readonly accessToken: string; readonly refreshToken: string }>; }
export interface ValidateAccessTokenUseCase { execute(accessToken: string, resource: string): Promise<PrincipalId | null>; }
