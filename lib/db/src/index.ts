import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.SUPABASE_DATABASE_URL) {
  throw new Error(
    "SUPABASE_DATABASE_URL must be configured for FarmDirect's database.",
  );
}

export const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  options: "-c search_path=farmdirect,public",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
