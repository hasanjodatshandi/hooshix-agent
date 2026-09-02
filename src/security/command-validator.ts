const allowedCommands = new Set(["node", "npm", "pnpm", "git", "python", "py", "powershell"]);

export function validateCommand(command: string, args: string[] = []): true {
  if (!allowedCommands.has(command.toLowerCase()) || command.includes("/") || command.includes("\\")) {
    throw new Error(`Command is not allowed: ${command}`);
  }
  if (args.some((argument) => argument.includes("\0") || argument.includes("\r") || argument.includes("\n"))) {
    throw new Error("Command arguments contain invalid control characters");
  }
  return true;
}
