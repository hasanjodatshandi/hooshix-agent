import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * R8.01 — HIGH-10 executed negative evidence. The static Dockerfile assertion in
 * tests/core/r0-known-defects.test.ts proves the fallback line is absent from the
 * image recipe; this test proves the POLICY ITSELF actually fails closed by
 * executing a real `pnpm install --frozen-lockfile` against a deliberately
 * mismatched manifest/lockfile pair in a throwaway directory.
 *
 * The Docker build cannot run on this host (daemon unreachable), but the frozen
 * install semantics are identical inside and outside the container, so this is
 * genuine executed negative evidence for the frozen-lock half of HIGH-10. The
 * container-build half still requires a Docker-capable target.
 */
describe("R8.01 HIGH-10 frozen lockfile fails closed when executed", () => {
  it("a stale manifest against a real lockfile aborts the install instead of regenerating it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hooshix-r8-frozen-"));
    const marker = path.join(root, ".r8-marker");
    fs.writeFileSync(marker, "r8", { flag: "wx" });
    try {
      // Copy the project's REAL lockfile so the frozen check has something
      // authoritative to compare against, then make the manifest disagree.
      const repo = process.cwd();
      for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
        fs.copyFileSync(path.join(repo, file), path.join(root, file));
      const manifest = path.join(root, "package.json");
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8")) as { dependencies: Record<string, string> };
      // A version that cannot possibly match the locked entry.
      pkg.dependencies["zod"] = "^99.0.0-never";
      fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2));

      // Resolve pnpm the same way the toolchain gate does (PATH lookup), because a
      // spawned test child does not inherit the shell's augmented PATH. On Windows
      // prefer the .CMD shim, which is what a shell would actually launch.
      const isWin = process.platform === "win32";
      const which = isWin
        ? spawnSync("cmd.exe", ["/d", "/c", "where pnpm"], { encoding: "utf8", windowsHide: true })
        : spawnSync("which", ["pnpm"], { encoding: "utf8" });
      const candidates = (which.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const pnpmPath = isWin
        ? candidates.find((s) => /\.cmd$/i.test(s)) ?? candidates[0]
        : candidates[0];
      expect(pnpmPath, "pnpm must be resolvable from PATH").toBeDefined();

      // Windows cannot launch a .CMD shim without a shell; the project paths here
      // never contain spaces, so no quoting is required on either platform.
      const result = isWin
        ? spawnSync("cmd.exe", ["/d", "/c", `${pnpmPath} install --frozen-lockfile --dir ${root} --registry=https://registry.npmjs.org`],
            { encoding: "utf8", windowsHide: true, timeout: 120000 })
        : spawnSync(pnpmPath!, ["install", "--frozen-lockfile", "--dir", root, "--registry=https://registry.npmjs.org"],
            { encoding: "utf8", timeout: 120000 });

      const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      // The install MUST fail, and it must fail for the frozen reason, never
      // silently regenerate the lockfile (which was the original HIGH-10 defect).
      expect(result.error).toBeUndefined();
      expect(result.status, combined).not.toBe(0);
      expect(combined).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
      // Nothing was installed: the node_modules directory must not exist.
      expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
    } finally {
      // Only ever delete the directory we created, inside the OS temp namespace,
      // verified by the marker we wrote.
      if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === "r8" &&
        path.dirname(root) === os.tmpdir())
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180000);
});
