import "dotenv/config";
import { Client } from "pg";

async function connectWithRetry(url: string, attempts = 8): Promise<Client> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
      await client.connect();
      console.log(`CONNECTED on attempt ${i}`);
      return client;
    } catch (e) {
      lastErr = e;
      console.log(`attempt ${i} failed, retrying in ${i * 2}s...`);
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
  throw lastErr;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("NO DATABASE_URL"); process.exit(1); }
  const client = await connectWithRetry(url);

  await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_handle" text;`);
  await client.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "public_profile" boolean DEFAULT false NOT NULL;`);
  await client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_public_handle_unique') THEN
         ALTER TABLE "users" ADD CONSTRAINT "users_public_handle_unique" UNIQUE("public_handle");
       END IF;
     END $$;`
  );
  console.log("MIGRATION 0002 APPLIED");

  const res = await client.query(
    `UPDATE users SET public_handle = 'posi', public_profile = true WHERE username = 'posi' RETURNING id, username, public_handle, public_profile`
  );
  console.log("PUBLIC USER:", JSON.stringify(res.rows[0]));

  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
