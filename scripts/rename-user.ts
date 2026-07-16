import "dotenv/config";
import { db } from "../lib/db";
import { users } from "../lib/schema";
import { eq } from "drizzle-orm";

async function main() {
  const oldName = process.argv[2] || "admin";
  const newName = process.argv[3] || "posi";

  const result = await db
    .update(users)
    .set({ username: newName, updatedAt: new Date() })
    .where(eq(users.username, oldName))
    .returning({ id: users.id, username: users.username });

  if (result.length === 0) {
    console.error(`User "${oldName}" not found`);
    process.exit(1);
  }

  console.log(`Renamed user: ${oldName} -> ${newName}`, result[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
