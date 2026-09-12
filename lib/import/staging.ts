import fs from "fs/promises";
import os from "os";
import path from "path";

/** Disk staging for uploaded GDPR zips (parse and run are separate calls). */
export function stagingDir(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "anon";
  return path.join(os.tmpdir(), `tvtime-import-${safe}`);
}

export async function clearStaging(userId: string): Promise<void> {
  await fs.rm(stagingDir(userId), { recursive: true, force: true });
}

/** Persist extracted CSVs for the later run call. Wipes any previous batch. */
export async function stageFiles(
  userId: string,
  files: Map<string, string>
): Promise<{ dir: string; count: number }> {
  const dir = stagingDir(userId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  let count = 0;
  for (const [name, content] of files) {
    const safe = path.basename(name);
    if (!safe || safe.startsWith(".")) continue;
    await fs.writeFile(path.join(dir, safe), content, "utf-8");
    count++;
  }
  return { dir, count };
}
