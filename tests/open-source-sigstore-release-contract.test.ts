import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");

describe("public open-source HooshiX release policy", () => {
  it("distributes the official Apache-2.0 license with installers", () => {
    const license = read("LICENSE");
    const build = read("scripts/build-windows-installer.mjs");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");
    expect(license).toContain("Grant of Copyright License");
    expect(license).toContain("Grant of Patent License");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(build).toContain('fs.copyFileSync(path.join(repo, "LICENSE"), path.join(appDir, "LICENSE"))');
    expect(read("README.md")).toContain("Apache License, Version 2.0");
  });

  it("only permits deliberate manually-dispatched draft releases", () => {
    const workflow = read(".github/workflows/release-sigstore.yml");
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("if (git ls-remote origin \"refs/tags/$env:RELEASE_TAG\")");
    expect(workflow).toContain("--draft --latest=false");
    expect(workflow).not.toMatch(/\bgh release edit\b[\s\S]*--draft=false/);
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("Release must be dispatched on main.");
  });

  it("signs exact bytes, verifies the pinned GitHub OIDC issuer and ships evidence", () => {
    const workflow = read(".github/workflows/release-sigstore.yml");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6");
    expect(workflow).toContain("cosign sign-blob --yes --bundle");
    expect(workflow).toContain("cosign verify-blob --bundle");
    expect(workflow).toContain("--certificate-identity $identity");
    expect(workflow).toContain("--certificate-oidc-issuer https://token.actions.githubusercontent.com");
    expect(workflow).toContain("github.com/$env:GITHUB_REPOSITORY/.github/workflows/release-sigstore.yml@refs/heads/main");
    expect(workflow).toContain('"$env:RELEASE_INSTALLER.sha256"');
    expect(workflow).toContain('"$env:RELEASE_INSTALLER.sigstore.json"');
    expect(workflow).toContain("& $installer --verify");
    expect(workflow).toContain("TestStagedInstaller(Payload|UpgradeAndRollbackContents)");
    expect(workflow).toContain("app/LICENSE");
    expect(read("docs/RELEASE_SIGSTORE.md")).toContain("unsigned for Windows Authenticode");
  });
});
