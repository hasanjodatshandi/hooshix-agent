# Device mesh, physical/virtual endpoints, RPA and teach mode

**Requirement IDs:** P-11/12/13/16/23. **Backlog:** B30–33/B40/B50.

## Do not conflate products
HooshiX developer-host Context/Ops/Desktop MCP under the independent Windows runtime is **not** the production EAAP Device Gateway or tenant-enrolled endpoint agent. Review/reuse only accepted contracts and safe engineering patterns after licensing/security/ownership analysis; no host admin rights or global developer credentials propagate to customers.

## Device and VM resource models
```text
Endpoint(deviceId, tenantId, owner, type PHYSICAL|VM|VIRTUAL_DESKTOP,
 guestOs, guestOsVersion, hostOrHypervisorRef?, enrolledAt, agentVersion,
 certificateRef, allowedApplications, capabilitySet+versions, policyDigest,
 health ONLINE|OFFLINE|SUSPENDED|REVOKED, sessionState+timestamp, lastSeen,
 leaseGeneration, maxInFlight, updateChannel, evidenceRetention)
Session(sessionId, endpointId, desktopKind, interactive, locked, permissions,
 windowStation/display properties, expiresAt, observedAt)
DeviceTask(taskId, runId, stepId, tenantId, actorRef, endpointId, capability,
 schemaVersion, expectedSessionRequirements, deadline, leaseToken,
 idempotencyKey, inputRef, outputRef, postcondition, state)
```
Separate endpoint identity for every VM guest; clone image MUST NOT include enrolled private key/ID. Ephemeral VM provisioning is **not required** merely to connect an existing VM; if introduced later it needs scoped hypervisor API/security/cleanup decision. A headless SERVER worker is not a GUI guest. Device identity uses an authenticated persistent **outbound** connection via gateway; if unsupported network/policy state, remain offline/wait safely.

## Enrollment and trust
Human/tenant-admin policy authorizes one enrollment bootstrap, proof of device possession and tenant binding; mint unique device identity/cert in guest after clone, record certificate expiry/rotation/revocation and approval. mTLS/short-lived workload identity, pinned gateway trust, capability registry authenticated with agent version and policy fingerprint. Server Authorization checks actor's permission on tenant/device/application/action; endpoint independently enforces local policy and session rights. Gateway never bypasses OS privilege boundaries, MFA/CAPTCHA, Secure Desktop, Winlogon or OS privacy prompts. Reject replay/forged heartbeat, stale capabilities, wrong tenant and expired leases.

## Control protocol
```text
EnrollRequest / EnrollResult
Heartbeat(deviceId, agentVersion, sessionState, capacity, capabilityDigest)
DispatchTask(taskId, attempt, leaseGeneration, commandSchemaVersion,
             classification, deadline, actorScopeProof, precondition)
TaskAccepted / TaskProgress / TaskOutcome(outputDigest, observedPostcondition)
CancelTask(taskId, attempt, leaseGeneration)
RevokeDevice / RotateDeviceCredential
```
Final schema lives in neutral contract registry with size bounds, replay IDs, version compatibility, safe error typing, redacted messages, explicit cancel and stable retry/idempotency. Presence updates cannot grant trust. Per-endpoint in-flight bound, policy/token rotation and task lease fencing prevent late old-guest results from committing after VM recreation or reassignment.

## Endpoint agent adapters
Shared service/runtime core handles enrollment, outbound connection, heartbeat, capability, task queue, cancellation, local policy, encrypted evidence/credential refs, version update. Windows bridge: UI Automation/Win32/approved Graphics Capture, input and credential broker under user's permitted session. macOS: Accessibility/ScreenCaptureKit/Keychain under approved TCC permissions. Linux: AT-SPI/D-Bus/XDG Portal/PipeWire with explicit Wayland/X11 distinctions and distro support. Rust/C#/Swift are historical **candidates**; no forced implementation language choice without HooshiX ADR + native packaging/security evaluation.

## Action selection / verification
Prefer native API/connector; then browser DOM; then accessibility role/name/automation ID; vision-grounded action if semantic metadata missing; raw coordinates only last resort with explicit brittle flag, bounded screen/layout and postcondition. Every material GUI action specifies expected application/window/session, read-before/write or stable semantic locator, postcondition within bounded wait, failure/uncertain state and evidence capture according to policy. Do not retry a non-idempotent click/type transaction on connection loss unless postcondition proves it did not happen.

## VM and desktop constraints
Qualified Windows VM guest can execute same schema as physical Windows if **real authorized interactive desktop session** and capture/input/accessibility capabilities available. RDP/disconnected/locked session behavior is OS/session-specific; report WAITING_FOR_DEVICE or SESSION_UNAVAILABLE and resume only when fresh session capability matches; do not unlock/bypass login for convenience. Existing always-on VM supported as registered endpoint; ephemeral creation/teardown is conditional future scope. Virtual desktop session (VDI) may represent a separate connection or guest agent depending on environment; do not assume a single host agent controls every tenant's VDI session.

## Teach by demonstration
Recorder is local opted-in, excludes passwords/secret UI; records semantic action trajectories, sanitized screenshots with classification, app/version/capability IDs and verified outcomes. A drafted skill must be reviewed/published with permissions, locator stability/retry bounds and version. On UI drift self-healing may propose alternative only under equivalent policy and verified postcondition; require approval or fail if target ambiguous/high-impact.

## Acceptance matrix
- Windows physical and Windows VM: same registered task (when interactive) and distinct identities/audit, safe UI action + result postcondition.
- Two VM clones: zero copied credentials, separate private identity and tenant scope; old guest cannot respond after revoke.
- Session missing/locked: explicit WAIT/FAIL with deadline, no bypass and no duplicate.
- Network loss during mutation: lease/ambiguous-reconciliation and correct run outcome.
- Endpoint-local deny while server allows: deny; server deny while endpoint allows: deny.
- macOS/Linux: publish actual tested OS/desktop/permission/virtualization combinations; unsupported features marked unsupported.
- Screenshot/recording redaction+expiry and constrained bandwidth/CPU/queue tests.
