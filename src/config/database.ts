import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { DATABASE_SCHEMA } from "./schema";
import { ENV } from "./env";

export const database = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

let connected = false;

database.on("error", (error) => {
  connected = false;
  console.error("Unexpected PostgreSQL pool error:", error);
});
database.on("connect", () => {
  connected = true;
});

export async function connectDB(): Promise<void> {
  await database.query(DATABASE_SCHEMA);
  await database.query("SELECT 1");
  connected = true;
  console.log("PostgreSQL database connected");
}

export function isDatabaseReady(): boolean {
  return connected;
}

export async function closeDatabase(): Promise<void> {
  connected = false;
  await database.end();
}

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = []
): Promise<QueryResult<Row>> {
  return database.query<Row>(text, [...values]);
}
