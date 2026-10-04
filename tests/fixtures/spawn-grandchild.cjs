// Spawns a grandchild that records its own pid, then both processes hang.
// Used to prove that cancelling/timing out a command reaps the whole process
// tree (Node -> Java/Gradle style chains) instead of stranding descendants.
const fs = require("fs");
const { spawn } = require("child_process");
const pidFile = process.argv[2];
const grandchild = spawn(process.execPath, ["-e", `
  require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
  setInterval(() => {}, 60000);
`], { stdio: "inherit" });
grandchild.on("exit", (code) => process.exit(code ?? 0));
setInterval(() => {}, 60000);
