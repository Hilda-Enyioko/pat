import { Pool } from "pg";
import { config } from "./config";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
  max: 5,
});
export const q = <T = any>(text: string, params: any[] = []): Promise<T[]> =>
  pool.query(text, params).then((r) => r.rows as T[]);
