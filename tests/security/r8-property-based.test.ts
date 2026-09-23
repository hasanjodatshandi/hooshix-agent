import { describe, expect, it } from "vitest";
import { isSensitivePath } from "../../src/application/services/sensitive-path-policy.js";
import { captureWorkspaceScope } from "../../src/domain/workspace/workspace-scope.js";
import type { WorkspaceScope } from "../../src/domain/workspace/workspace-scope.js";

/**
 * R8.04 — property-based (fuzz) contracts with a RECORDED SEED. The plan
 * requires property-based tests for invalid inputs, permission boundaries,
 * workspace boundaries and recovery contracts, with reproducible seeds.
 *
 * No external fuzzing dependency is added: a small deterministic PRNG (xorshift)
 * drives randomized but reproducible inputs. The seed is fixed and recorded
 * below; a failing case prints the exact seed and input so it can be reproduced
 * and then converted into a permanent regression if it exposes a real defect.
 *
 * Reproduction: if a case fails, the reporter shows SEED=<value> and the input.
 * Re-run with the same seed to reproduce deterministically.
 */

/** Deterministic xorshift32 PRNG. NOT cryptographic — fuzz input only. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const RECORDED_SEED = 0x484f5348; // "HOSH" — fixed seed, do not randomize
const CASES = 400;

function randomString(rand: () => number, alphabet: string, minLen: number, maxLen: number): string {
  const length = minLen + Math.floor(rand() * (maxLen - minLen + 1));
  let out = "";
  for (let index = 0; index < length; index++)
    out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}

// Path metacharacters that must never escape normalization or the denylist.
const EDGE_ALPHABET = "abcABC019./_-\\.%$*?\"' \t\u0000";

describe("R8.04 property-based contracts (seeded)", () => {
  it("SEED recorded: every sensitive path is denied regardless of casing, separators or traversal padding", () => {
    const rand = createPrng(RECORDED_SEED);
    const sensitiveBasename = [
      ".token", ".env", ".env.local", ".env.production", "id_rsa", "id_ed25519",
      ".npmrc", ".netrc", ".htpasswd", "credentials.json", "secrets.json", "secrets.yml",
    ];
    const sensitiveExtension = [".pem", ".key", ".pfx", ".p12", ".kdbx"];
    const sensitiveDir = [".ssh", ".gnupg", ".aws", ".azure"];

    for (let attempt = 0; attempt < CASES; attempt++) {
      const mode = Math.floor(rand() * 4);
      let path: string;
      let label: string;
      if (mode === 0) {
        const base = sensitiveBasename[Math.floor(rand() * sensitiveBasename.length)];
        path = base;
        label = `basename ${base}`;
      } else if (mode === 1) {
        const ext = sensitiveExtension[Math.floor(rand() * sensitiveExtension.length)];
        const name = randomString(rand, "abcdefg", 1, 12);
        path = name + ext;
        label = `extension ${ext}`;
      } else if (mode === 2) {
        const dir = sensitiveDir[Math.floor(rand() * sensitiveDir.length)];
        const name = randomString(rand, "abcdefg", 1, 10);
        path = `${dir}/${name}`;
        label = `dir ${dir}`;
      } else {
        // Random case mutation of a sensitive basename — casing must not bypass.
        const base = sensitiveBasename[Math.floor(rand() * sensitiveBasename.length)];
        path = base.split("").map((ch) => (rand() < 0.5 ? ch.toUpperCase() : ch)).join("");
        label = `case-mutated ${base}`;
      }
      // Randomly prepend traversal padding and mixed separators.
      const padding = Math.floor(rand() * 4);
      for (let prepend = 0; prepend < padding; prepend++)
        path = (rand() < 0.5 ? "../" : "..\\") + path;
      // Uppercasing a sensitive extension must still be denied.
      if (rand() < 0.5) path = path.replace(/\.pem$/, ".PEM").replace(/\.key$/, ".KEY");

      const result = isSensitivePath(path);
      if (!result) {
        // Print the seed and the offending input for reproduction.
        console.error(`SEED=${RECORDED_SEED.toString(16)} attempt=${attempt} label=${label} path=${JSON.stringify(path)}`);
      }
      expect(result, `SEED=${RECORDED_SEED.toString(16)} attempt=${attempt} label=${label} path=${JSON.stringify(path)}`).toBe(true);
    }
  });

  it("SEED recorded: a benign path is never falsely denied (no over-blocking)", () => {
    const rand = createPrng(RECORDED_SEED ^ 0x4f564552); // "OVER"
    const benignNames = [
      "readme", "index", "main", "config", "notes", "draft", "summary",
      "chapter", "report", "letter", "todo", "plan", "spec", "guide",
    ];
    const benignExtensions = [".md", ".txt", ".json", ".ts", ".js", ".cjs", ".csv", ""];

    for (let attempt = 0; attempt < CASES; attempt++) {
      const name = benignNames[Math.floor(rand() * benignNames.length)]
        + randomString(rand, "0123456789", 0, 3);
      const extension = benignExtensions[Math.floor(rand() * benignExtensions.length)];
      const path = name + extension;
      // Over-blocking would break legitimate work; the denylist must be precise.
      if (isSensitivePath(path)) {
        console.error(`SEED=${(RECORDED_SEED ^ 0x4f564552).toString(16)} attempt=${attempt} path=${JSON.stringify(path)}`);
      }
      expect(isSensitivePath(path), `SEED=${(RECORDED_SEED ^ 0x4f564552).toString(16)} attempt=${attempt} path=${JSON.stringify(path)} (benign path falsely denied)`).toBe(false);
    }
  });

  it("SEED recorded: workspace scope capture is idempotent, frozen and never drops a root", () => {
    const rand = createPrng(RECORDED_SEED ^ 0x53434f50); // "SCOP"
    const roots = ["D:/projects/alpha", "D:/projects/beta", "/home/gamma", "E:/work/delta"];

    for (let attempt = 0; attempt < CASES; attempt++) {
      const count = 1 + Math.floor(rand() * 4);
      const selected: string[] = [];
      for (let pick = 0; pick < count; pick++)
        selected.push(roots[Math.floor(rand() * roots.length)]);
      const scope: WorkspaceScope = {
        principalId: "principal-fixture" as never,
        sessionId: "session-fixture" as never,
        root: rand() < 0.5 ? null : selected[0],
        allowedRoots: selected,
        unrestricted: false,
        capturedAt: "2026-09-23T00:00:00.000Z",
      };
      const first = captureWorkspaceScope(scope);
      const second = captureWorkspaceScope(scope);

      // Capturing twice from the same scope must yield equivalent results.
      expect(second).toEqual(first);
      // The capture must be frozen: mutation must not propagate.
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.allowedRoots)).toBe(true);
      // Every requested root must survive the capture.
      expect(first.allowedRoots).toEqual(selected);
    }
  });

  it("SEED recorded: workspace scope capture rejects an empty principal or session identity", () => {
    const rand = createPrng(RECORDED_SEED ^ 0x4944); // "ID"
    for (let attempt = 0; attempt < CASES; attempt++) {
      const emptyPrincipal = rand() < 0.5;
      const scope: WorkspaceScope = {
        principalId: (emptyPrincipal ? "" : "principal-fixture") as never,
        sessionId: (emptyPrincipal ? "session-fixture" : "") as never,
        root: null,
        allowedRoots: ["D:/projects/alpha"],
        unrestricted: false,
        capturedAt: "2026-09-23T00:00:00.000Z",
      };
      // A task must never be created without a bound identity.
      expect(() => captureWorkspaceScope(scope), `SEED=${(RECORDED_SEED ^ 0x4944).toString(16)} attempt=${attempt} emptyPrincipal=${emptyPrincipal}`).toThrow(/principal\/session identity/);
    }
  });

  it("SEED recorded: edge-character inputs never crash the sensitive-path policy", () => {
    const rand = createPrng(RECORDED_SEED ^ 0x45444745); // "EDGE"
    for (let attempt = 0; attempt < CASES; attempt++) {
      const input = randomString(rand, EDGE_ALPHABET, 0, 40);
      // The contract is "returns boolean without throwing", whatever the input.
      expect(() => isSensitivePath(input)).not.toThrow();
      expect(typeof isSensitivePath(input)).toBe("boolean");
    }
  });
});
