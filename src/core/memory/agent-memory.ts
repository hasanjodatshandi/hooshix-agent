import fs from "node:fs/promises";
import path from "node:path";

function memoryFile(): string {
  return path.resolve(process.env.HOOSHIX_MEMORY_FILE ?? "./data/agent-memory.json");
}

export async function saveMemory(data: unknown) {
  const destination = memoryFile();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(data, null, 2), "utf8");
}

export async function loadMemory() {
  try {
    return JSON.parse(await fs.readFile(memoryFile(), "utf8"));
  } catch {
    return null;
  }
}
