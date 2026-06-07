import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let client: Client;

describe("database integration setup", () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for integration tests");
    }

    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("applies baseline migrations and creates outbox tables", async () => {
    const migrations = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM "_prisma_migrations"',
    );
    const outboxTable = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'outbox_events'
      ) AS exists
    `);

    expect(Number(migrations.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(3);
    expect(outboxTable.rows[0]?.exists).toBe(true);
  });
});
