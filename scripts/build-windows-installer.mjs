#!/usr/bin/env node
/**
 * Build the single-file Windows installer for the HooshiX MCP service.
 *
 * The artifact is one executable an operator double-clicks:
 *
 *   [ setup executable ][ runtime archive ][ 32-byte trailer ]
 *
 * The archive carries the Node runtime, the built application and its production
 * dependencies, so there is nothing to install first and no second file to keep
 * beside it. It is appended rather than embedded with `go:embed` on purpose: a
 * committed placeholder would let `go build ./...` pass while shipping an
 * installer that installs nothing, and a hundred megabytes of runtime does not
 * belong in git. With this shape, a payload-less setup.exe is always a mistake
 * made here, and the installer says so out loud.
 *
 * Run it with the Node the project pins in .nvmrc — the same version that goes
 * into the payload — because `dist/` is compiled by the runtime that builds it:
 *
 *   node scripts/build-windows-installer.mjs [--skip-build] [--node <node.exe>] [--out <file>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = path.join(repo, "deploy", "windows");
const buildDir = path.join(moduleDir, "build");
const binDir = path.join(buildDir, "bin");
const payloadDir = path.join(buildDir, "payload");
const executableSuffix = process.platform === "win32" ? ".exe" : "";

const expected = fs.readFileSync(path.join(repo, ".nvmrc"), "utf8").trim();
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const options = parseArguments(process.argv.slice(2));

try {
	main();
} catch (error) {
	console.error(`\nbuild-windows-installer: ${error.message ?? error}`);
	process.exit(1);
}

function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "hooshix-installer-"));
	try {
		checkToolchain();
		const nodeRuntime = locateNodeRuntime(options.node);
		// pnpm and the compiler take `node` from PATH, so the pinned runtime has to
		// come first there: an installer whose dist/ was produced by a different
		// engine is the exact failure this file exists to prevent.
		const runtime = { env: { ...process.env, PATH: `${path.dirname(nodeRuntime)}${path.delimiter}${process.env.PATH}` } };
		if (!options.skipBuild) {
			step("compiling the application");
			compileApplication(nodeRuntime);
		}
		requireBuiltEntry();

		step("collecting the payload");
		fs.rmSync(payloadDir, { recursive: true, force: true });
		fs.mkdirSync(path.join(payloadDir, "runtime"), { recursive: true });
		fs.copyFileSync(nodeRuntime, path.join(payloadDir, "runtime", "node.exe"));

		const appDir = path.join(payloadDir, "app");
		fs.mkdirSync(appDir, { recursive: true });
		fs.copyFileSync(path.join(repo, "package.json"), path.join(appDir, "package.json"));
		// Binary redistributions must include the project\x27s open-source license.
		fs.copyFileSync(path.join(repo, "LICENSE"), path.join(appDir, "LICENSE"));
		fs.cpSync(path.join(repo, "dist"), path.join(appDir, "dist"), { recursive: true });
		installProductionDependencies(appDir, scratch, runtime);

		step("building the Windows binaries");
		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(path.join(payloadDir, "bin"), { recursive: true });
		buildWindowsBinary("./cmd/hooshix-mcp-service", path.join(payloadDir, "bin", "hooshix-mcp-service.exe"), false);
		buildWindowsBinary("./cmd/hooshix-mcp-tray", path.join(payloadDir, "bin", "hooshix-mcp-tray.exe"), true);
		// Opt-in user-session Git transport; never registered as a SYSTEM service.
		buildWindowsBinary("./cmd/hooshix-git-worker", path.join(payloadDir, "bin", "hooshix-git-worker.exe"), false);
		// Windows-only payload: owner Git worker is retained for Windows repositories.
		const setup = path.join(binDir, "hooshix-mcp-setup.exe");
		buildWindowsBinary("./cmd/hooshix-mcp-setup", setup, false);
		const assembler = path.join(binDir, `make-setup${executableSuffix}`);
		buildHostBinary("./cmd/make-setup", assembler);

		step("assembling the installer");
		const installer =
			options.out ??
			path.join(buildDir, `HooshiX-MCP-Setup-${manifest.version}${executableSuffix}`);
		run(assembler, [
			"-setup", setup,
			"-tree", payloadDir,
			"-archive", path.join(buildDir, "runtime.zip"),
			"-out", installer,
		], { cwd: moduleDir });

		report(installer);
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

/**
 * checkToolchain runs the repository's own runtime gate. Compiling `dist/` with
 * a different engine than the one inside the payload is how an installer ships a
 * server that dies on the first request, and the gate already knows the exact
 * lines .nvmrc and packageManager pin.
 */
function checkToolchain() {
	step("checking the toolchain");
	run(process.execPath, [path.join(repo, "scripts", "verify-runtime-versions.mjs")], { cwd: repo });
}

/**
 * locateNodeRuntime finds a node.exe that reports exactly the pinned version.
 * The version is checked by asking the binary, not by trusting a directory name:
 * an nvm symlink can point somewhere else than it is called.
 */
function locateNodeRuntime(requested) {
	const candidates = [requested, process.env.HOOSHIX_NODE_EXE, nvmRoot() && path.join(nvmRoot(), `v${expected}`, "node.exe"), process.execPath];
	for (const candidate of candidates) {
		if (!candidate || !fs.existsSync(candidate)) continue;
		const version = execFileSync(candidate, ["-v"], { encoding: "utf8" }).trim();
		if (version === `v${expected}`) return candidate;
		console.log(`  ${candidate} reports ${version}, not the pinned v${expected}`);
	}
	throw new Error(
		`no node.exe reporting v${expected} was found. Install it (nvm install ${expected}) ` +
		`or pass --node <path to node.exe>.`,
	);
}

function nvmRoot() {
	if (process.env.NVM_HOME) return process.env.NVM_HOME;
	const settings = path.join(process.env.APPDATA ?? "", "nvm", "settings.txt");
	if (!fs.existsSync(settings)) return undefined;
	const match = /^root:\s*(.+)$/m.exec(fs.readFileSync(settings, "utf8"));
	return match ? match[1].trim() : undefined;
}

/**
 * installProductionDependencies builds a flat, symlink-free node_modules from the
 * lockfile in a scratch copy of the manifests, outside the repository so the
 * workspace root cannot change what is installed.
 *
 * The hoisted linker is the point: a symbolic link inside Program Files is a path
 * the installer refuses to create and a support engineer cannot read, and `pnpm
 * deploy` was measured to leave dozens of them. --prod keeps devDependencies out
 * of the payload, and the copied pnpm-workspace.yaml is what keeps the
 * better-sqlite3 build script switched off so the prebuilt win32 binary is used.
 */
function installProductionDependencies(appDir, scratch, runtime) {
	const project = path.join(scratch, "app");
	fs.mkdirSync(project, { recursive: true });
	for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
		fs.copyFileSync(path.join(repo, file), path.join(project, file));
	}
	step("installing production dependencies");
	runPackageManager([
		"install", "--prod", "--node-linker=hoisted", "--frozen-lockfile",
		...(options.registry ? [`--registry=${options.registry}`] : []),
	], { cwd: project, ...runtime });
	fs.cpSync(path.join(project, "node_modules"), path.join(appDir, "node_modules"), { recursive: true });
}

function requireBuiltEntry() {
	const entry = path.join(repo, "dist", "index-http.js");
	for (const retired of [
		"security/wsl-file-backup.js", "security/wsl-mutation-service.js",
		"security/wsl-workspace-binding.js", "security/wsl-workspace-client.js",
		"security/wsl-workspace-uri.js", "services/shell/wsl-worker-client.js",
	]) {
		if (fs.existsSync(path.join(repo, "dist", retired))) {
			throw new Error(`stale retired WSL compiler output: ${retired}. Run pnpm build to clean and recompile.`);
		}
	}
	if (!fs.existsSync(entry)) {
		throw new Error(`${entry} is missing: run \`pnpm build\` first, or drop --skip-build`);
	}
}

/**
 * compileApplication runs the project's own compiler with the runtime that is
 * about to be shipped inside the payload.
 *
 * It deliberately does not go through `pnpm run build`: a package manager that
 * verifies dependencies before a script is free to re-resolve the tree, and doing
 * that here pruned this project's devDependencies mid-build. Producing an
 * installer must never be able to change what is installed.
 */
function compileApplication(nodeRuntime) {
	const compiler = path.join(repo, "node_modules", "typescript", "bin", "tsc");
	if (!fs.existsSync(compiler)) {
		throw new Error(`${compiler} is not installed: run \`pnpm install\` first`);
	}
	// The same project file `pnpm build` names, so the installer and CI cannot
	// disagree about what dist/ holds.
	run(nodeRuntime, [path.join(repo, "scripts", "clean-dist.mjs")], { cwd: repo });
	run(nodeRuntime, [compiler, "-p", "tsconfig.json"], { cwd: repo });
}

function buildWindowsBinary(pkg, output, gui) {
	const flags = ["-s", "-w"];
	if (gui) flags.push("-H=windowsgui");
	// Installer provenance is verified by release preflight + SHA-256 manifest.
	// Building from a read-only or separately owned source checkout must not
	// depend on Git stamping inside the Go toolchain.
	run("go", ["build", "-buildvcs=false", "-trimpath", `-ldflags=${flags.join(" ")}`, "-o", output, pkg], {
		cwd: moduleDir,
		env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
	});
}

function buildHostBinary(pkg, output) {
	run("go", ["build", "-buildvcs=false", "-trimpath", "-o", output, pkg], {
		cwd: moduleDir,
		env: { ...process.env, CGO_ENABLED: "0" },
	});
}

function report(installer) {
	const size = fs.statSync(installer).size;
	const digest = sha256(installer);
	const checksums = `${digest}  ${path.basename(installer)}\n`;
	fs.writeFileSync(`${installer}.sha256`, checksums);
	console.log(`\ninstaller: ${installer}`);
	console.log(`   size: ${(size / 1024 / 1024).toFixed(1)} MB`);
	console.log(`  sha256: ${digest}`);
	console.log(`  verify: certutil -hashfile "${installer}" SHA256`);
}

// sha256 reads in chunks because the file it fingerprints is the size of a Node
// distribution, and a build script should not need that much memory.
function sha256(file) {
	const hash = crypto.createHash("sha256");
	const descriptor = fs.openSync(file, "r");
	const buffer = Buffer.alloc(1 << 20);
	try {
		for (let read = fs.readSync(descriptor, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(descriptor, buffer, 0, buffer.length, null)) {
			hash.update(buffer.subarray(0, read));
		}
	} finally {
		fs.closeSync(descriptor);
	}
	return hash.digest("hex");
}

function parseArguments(argv) {
	const parsed = { skipBuild: false };
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--skip-build") parsed.skipBuild = true;
		else if (argument === "--node") parsed.node = value(argv, ++index, argument);
		else if (argument === "--out") parsed.out = value(argv, ++index, argument);
		else if (argument === "--registry") {
			const registry = value(argv, ++index, argument);
			if (registry !== "https://registry.npmjs.org/") {
				throw new Error("--registry currently supports only the official npm registry over HTTPS");
			}
			parsed.registry = registry;
		}
		else if (argument === "-h" || argument === "--help") {
			console.log("usage: build-windows-installer.mjs [--skip-build] [--node <node.exe>] [--out <file>] [--registry https://registry.npmjs.org/]");
			process.exit(0);
		} else throw new Error(`unknown argument ${argument}`);
	}
	return parsed;
}

function value(argv, index, name) {
	if (index >= argv.length) throw new Error(`${name} needs a value`);
	return argv[index];
}

function step(message) {
	console.log(`\n==> ${message}`);
}

function run(command, args, { cwd, env, shell }) {
	// With a shell Node concatenates the arguments instead of escaping them, so the
	// tokens are joined here, quoted where they contain a space, and handed over as
	// a single string: a profile directory with a space in it then survives the way
	// it would in a terminal, and Node stops warning about the concatenation itself.
	const invocation = shell ? [command, ...args].map(quoteToken).join(" ") : command;
	const result = spawnSync(invocation, shell ? [] : args, {
		cwd,
		env: env ?? process.env,
		stdio: "inherit",
		shell: shell ?? false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with status ${result.status ?? "signal"}`);
	}
}

function quoteToken(token) {
	return /[\s"]/.test(token) ? `"${token.replaceAll('"', '\\"')}"` : token;
}

/**
 * runPackageManager invokes pnpm. On Windows the PATH entry is a .cmd shim, which
 * Node will not spawn without a shell because it is not an executable, so cmd.exe
 * resolves it the way a terminal would. Elsewhere `pnpm` is already a real
 * program and no shell is involved.
 */
function runPackageManager(args, { cwd, env }) {
	// Corepack reads the exact pnpm pin from package.json. A machine-wide
	// pnpm shim is not required for the Windows LocalSystem build account.
	run("corepack", ["pnpm", ...args], { cwd, env, shell: process.platform === "win32" });
}
