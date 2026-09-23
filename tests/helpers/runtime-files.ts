import path from "node:path";

/**
 * R8.06: parallel Vitest workers need disjoint scratch directories. A single
 * shared `tests/runtime-files` tree let one worker recursively delete another
 * worker's in-flight fixtures, which is the remaining parallel-suite failure
 * after the shared database was isolated. Tests that need a filesystem scratch
 * root must use this instead of a literal `tests/runtime-files` path.
 */
const workerId = process.env.VITEST_WORKER_ID ?? "single";
// Always emit forward slashes: the workspace services normalize relative paths
// this way, and Node accepts them on Windows too.
export const RUNTIME_FILES_ROOT = path.posix.join("tests", `runtime-files-${workerId}`);
