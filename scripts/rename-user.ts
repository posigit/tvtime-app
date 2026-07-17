import "dotenv/config";
import { db, pingDb, pool } from "../lib/db";
import { users } from "../lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  const oldName = process.argv[2] || "admin";
  const newName = process.argv[3] || "posi";

  // Wait out Railway "database system is starting up" (57P03)
  console.log("Waiting for database…");
  await pingDb();

  const result = await db
    .update(users)
    .set({ username: newName, updatedAt: new Date() })
    .where(eq(users.username, oldName))
    .returning({ id: users.id, username: users.username });

  if (result.length === 0) {
    console.error(`User "${oldName}" not found`);
    await pool.end();
    process.exit(1);
  }

  console.log(`Renamed user: ${oldName} -> ${newName}`, result[0]);
  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
