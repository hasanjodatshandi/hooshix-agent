# R7 local HTTP and container operations (feature-branch working runbook)

Status: R7 implementation document. This is NOT a production release or a replacement for the R9 final operations guide.

## Supported security contract

- Use Node.js 24 and pnpm 11.24.0; install with `pnpm install --frozen-lockfile`, then `pnpm run typecheck && pnpm run build`.
- The default local HTTP listener is `127.0.0.1:3001`. Start with `node dist/index-http.js` or `scripts/start_nodejs_mcp.bat` from a deliberately configured environment. Do not start another instance when the port already has an unowned listener.
- `GET /health/live` is unauthenticated and returns only `{"status":"ok"}`. `GET /health/ready` returns a minimal readiness result; `GET /health` is a protected monitoring endpoint, not the liveness probe.
- The bootstrap credential is an operator-only secret, NOT an MCP bearer/access token. The server accepts `HOOSHIX_BOOTSTRAP_TOKEN` (minimum 32 UTF-8 bytes), otherwise loads a securely generated local token file. Default file location for Windows/local mode: `.token` in the service working directory; container mode: `HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token`. Never copy a bootstrap secret into client `Authorization` headers. Use OAuth discovery and authorization code/PKCE for MCP clients; use the operator login for browser diagnostics.
- `MCP_API_KEY` and `MCP_ACCESS_TOKEN` are REMOVED legacy input names and cause explicit startup failure; eliminate them from host/service environments. Neither an empty legacy variable nor an old watchdog configuration is permitted.
- To use a trusted external TLS edge, explicitly set `HOOSHIX_PUBLIC_BASE_URL=https://your-approved-host` for the running process. Do not embed an endpoint or token in tracked scripts. Public exposure, TLS, authorization, rollback and workload qualification remain separate release gates.

## Docker / Compose

- `docker build -t hooshix-agent:reviewed .` uses frozen dependency resolution in BOTH build and runtime layers. The production image runs as user `node`; only `/app/data` is prepared as a writable persistent directory. Its SQLite path, logs and bootstrap file live there.
- Direct `docker run` without a configured HTTPS edge is for an INTERNAL local health/process smoke only: Docker's default in-container HTTP bind is loopback. Do not claim that publishing `-p` alone makes a secure or reachable remote MCP interface.
- For the existing Compose example, supply an approved external `HOOSHIX_PUBLIC_BASE_URL` through the operator environment. Compose binds the container to `0.0.0.0:3001` internally, but publishes only host `127.0.0.1:3001` for the separately managed TLS edge. Do NOT publish the container port publicly or expose the local HTTP backend directly to the Internet.
- Keep `mcp-data` persistent and protect its contents, including OAuth tokens, SQLite files and `.token`. Do not change/migrate live data to validate R7. Rehearse migration on a copy during G10.
- The Docker image base currently uses the controlled major tag `node:24-slim`. Before public release, select and record the reviewed immutable upstream digest, refresh it on reviewed dependency-update PRs, and run the entire CI/container smoke gate. Do not claim image-level byte-for-byte reproducibility until the digest is pinned and checked.

## Windows watchdog / manual startup

- The watchdog probes unauthenticated `/health/live` and must NEVER pass the obsolete `MCP_ACCESS_TOKEN` variable into the server. The operator supplies an optional public base URL in the service environment. Check OS process ownership before stopping/restarting; unowned Node processes cannot be terminated by the watchdog.
- For manual local use, `scripts/start_nodejs_mcp.bat` resolves the project relative to its own location. The watchdog remains intentionally separate from release cutover and must not be restarted against active operational data merely to test these changes.
- An operator inspecting a token with `scripts/mcp-token.ps1 show` must keep the terminal output private. The generated/bootstrap secret is not a raw OAuth access token.

## Validation and boundary

R7 acceptance requires an ACTUAL clean-checkout CI run, a real frozen image build and startup, non-root runtime and health probes, config/legacy migration tests, source/secret scan, and successful version preflight from a service-like environment. Passing static tests and a local TypeScript build alone is not G7 PASS. No live migration, restart, deployment, merge, push or release is authorized by this runbook.
