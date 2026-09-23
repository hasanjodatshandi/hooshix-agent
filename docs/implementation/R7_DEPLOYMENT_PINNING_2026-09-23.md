# R7.06 — Base image pinning and controlled update procedure

Workspace: `D:/workspace/hooshix-agent`. R7 IN_PROGRESS / G7 OPEN. No live deployment, push or merge.

## Pinned base image

Both Dockerfile stages (builder and production) use the same pinned base image:

```dockerfile
FROM node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
```

## Why this image

| Requirement | How it is satisfied |
|---|---|
| Specified Node.js 24 family | `24.18.0-slim` tracks the Node 24 LTS line. |
| Exact version parity | The tag pins Node `24.18.0`, identical to `.nvmrc` (`24.18.0`) and the CI `setup-node` version, so local service, container, watchdog and CI all run the same Node line. |
| Valid, specific digest | `sha256:6f7b03f7…6951452d` is the multi-arch OCI index digest for the `24.18.0-slim` tag. |

## Digest provenance

- Queried the public Docker Hub registry API
  `https://hub.docker.com/v2/repositories/library/node/tags/24.18.0-slim` on **2026-09-23**.
- The tag reported `tag_status: active`, `media_type: application/vnd.oci.image.index.v1+json`
  and the index digest above, with `linux/amd64`, `linux/arm64` and `linux/ppc64le` member images.
- The digest is written into the Dockerfile, so a build resolves the exact image content
  regardless of later tag movement.

## Controlled update procedure for the base image

The rolling `24-slim` tag was replaced by a digest-pinned exact tag precisely so that base-image
movement can never silently change a production artifact. To update the base image:

1. Decide the target Node line from `.nvmrc` first; the Docker tag, `.nvmrc` and the CI
   `setup-node` version must always agree.
2. Query the registry API for the replacement tag and record the new index digest and query date
   in this file.
3. Update **both** `FROM` lines in `Dockerfile` in the same change.
4. Re-run the container smoke gate: the negative stale-lockfile build, the image build, the
   `node` non-root user check, `/health/live` becoming `healthy`, `/health/ready` and the
   authenticated `/health` 401 assertion (see `.github/workflows/ci.yml`, `container-smoke`).
5. Confirm `better-sqlite3` native bindings still load in the Linux container and that
   `pnpm install --frozen-lockfile` still resolves for the pinned pnpm (`11.24.0`).
6. Record the result and date in the ledger; do not treat a digest change as accepted until the
   container smoke gate has actually run green on a Docker-capable target.

## Verification boundary (honest status)

- Digest existence and activeness were verified against the registry API on 2026-09-23.
- **An actual image build was NOT executed here**: this development host has the Docker CLI but the
  daemon is not accessible (`permission denied while trying to connect to the docker API`), the same
  limitation recorded in `R7_PROGRESS_2026-09-23.md`. Therefore Node/pnpm/native-dependency
  compatibility inside the pinned image, and the build/container smoke re-run, remain pending a
  Docker-capable target. The `container-smoke` CI job owns that proof; it is encoded, not bypassed.
- This record does not claim G7 PASS, R7.06 VERIFIED_CLOSED, or any deployment readiness.
