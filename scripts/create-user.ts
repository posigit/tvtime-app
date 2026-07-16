import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../lib/db";
import { users } from "../lib/schema";

async function main() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin";

  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.username, username),
  });

  if (existing) {
    console.log(`User ${username} already exists`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.insert(users).values({
    id: crypto.randomUUID(),
    username,
    passwordHash,
  });

  console.log(`Created user: ${username}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
