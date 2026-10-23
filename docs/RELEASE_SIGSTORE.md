# HooshiX MCP: free public releases with SHA-256 and Sigstore

## Scope and security model

- Source: public GitHub repository `hasanjodatshandi/hooshix-agent`.
- License for HooshiX original code: Apache-2.0 in `LICENSE`. Bundled third-party components retain their own licenses.
- Windows installer: **unsigned for Windows Authenticode**. SmartScreen and Unknown Publisher warnings are possible.
- Signing: Sigstore keyless signing of the exact finished EXE in GitHub Actions using GitHub OIDC and a public Fulcio short-lived signing certificate. A portable `.sigstore.json` bundle includes verification evidence. No payment or long-lived signing secrets required.
- GitHub Release creation is **manual and always DRAFT**. No installer is published for customers and no production Windows Service is modified automatically.
- The Release workflow uses a SHA-pinned Sigstore installer and immutable source checkout.
- A valid Sigstore signature authenticates the official workflow identity and file integrity. It does *not* make a Windows executable trusted by SmartScreen, nor does it approve its safety or deployment.

## Creating a draft release (repository owner)

1. Confirm all CI jobs have passed on the `main` commit. Confirm release gates for source, dependency audit, backup and controlled deployment.
2. Go to [Actions](https://github.com/hasanjodatshandi/hooshix-agent/actions/workflows/release-sigstore.yml), click **Run workflow**, choose branch `main`, and enter a **new** version tag, e.g. `v0.1.0-rc.1`.
3. The Windows runner builds from `main`, verifies the embedded payload, preserves `app/LICENSE`, checks SHA-256, tests isolated upgrade/rollback, signs the binary with Sigstore, verifies the signer identity, and creates a Draft Release for the provided tag.
4. Inspect the Draft Release in GitHub Releases. The release includes an unsigned `.exe`, an `.exe.sha256` checksum, and an `.exe.sigstore.json` signature bundle.
5. **Publishing** the draft is a separate, explicit decision. Complete independent Windows SCM cutover/rollback testing before promoting an installer as supported for customer deployment.

The workflow refuses to run on branches other than `main`, to reuse an existing tag, or to continue if `main` advances during preparation.

## Checking a downloaded file (end user)

Keep the three files together, retaining their unchanged names. Download the official Cosign binary from [Sigstore releases](https://github.com/sigstore/cosign/releases) and follow its [installation guidance](https://docs.sigstore.dev/cosign/system_config/installation/). Then in Windows PowerShell:

```powershell
$installer = ".\HooshiX-MCP-v0.1.0-rc.1-unsigned.exe"
$hashFile = "$installer.sha256"
$bundle = "$installer.sigstore.json"

$expected = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
if ($actual -ine $expected) { throw "SHA-256 mismatch: do not run this installer." }

cosign verify-blob --bundle $bundle `
  --certificate-identity "https://github.com/hasanjodatshandi/hooshix-agent/.github/workflows/release-sigstore.yml@refs/heads/main" `
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" `
  $installer
if ($LASTEXITCODE -ne 0) { throw "Sigstore verification failed; do not run this installer." }
```

The identity and issuer above must match the **official** release workflow, not a fork or arbitrary GitHub actor. SHA-256 alone detects changes against the published checksum, but only verification of the signed Sigstore bundle establishes the advertised workflow identity.

## Release operator checklist

- Public source contains the intended LICENSE and no secrets or unauthorized third-party code.
- Build source commit is on reviewed `main`; frozen dependencies, tests and source integrity audit passed.
- The exact Windows installer `--verify` and isolated rollback regression test pass before signing.
- The EXE SHA-256 is independently recomputed from bytes; the checksum asset matches exactly.
- Sigstore keyless bundle verification succeeds with both expected certificate identity and GitHub OIDC issuer.
- Windows service account, WSL enrollment, database backups and live upgrade/rollback have been exercised separately by an independent administrator console (the product itself cannot safely control its own recovery).
- Draft Release stays unpublished until the owner explicitly authorizes publishing.

For the Apache-2.0 license terms, see `LICENSE`. For project-specific documentation, see `docs/INDEX.md`.
