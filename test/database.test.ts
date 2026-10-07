import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { configureTestEnvironment } from "./testEnvironment";

configureTestEnvironment();
const databaseUrl = process.env.DATABASE_TEST_URL;

if (databaseUrl) {
  let databaseName: string;
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error();
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("DATABASE_TEST_URL must be a valid PostgreSQL connection URL");
  }
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(databaseName)) {
    throw new Error("DATABASE_TEST_URL must target a database whose name clearly contains 'test'");
  }
  process.env.DATABASE_URL = databaseUrl;
}

test("PostgreSQL persists user records and enforces unique email indexes", {
  skip: !databaseUrl && "Set DATABASE_TEST_URL to an isolated PostgreSQL test database",
}, async () => {
  const { connectDB, closeDatabase, query } = await import("../src/config/database");
  const { createUser, findUserById, findUserByIdentifier } = await import("../src/models/User.model");
  const unique = randomUUID();
  const email = `integration-${unique}@example.invalid`;
  const mobile = `+1555${Date.now().toString().slice(-7)}`;

  await connectDB();
  let createdId: string | undefined;
  try {
    const created = await createUser({
      name: "Database Integration Test",
      email,
      mobile,
      role: "buyer",
    });
    createdId = created._id;
    const fetched = await findUserById(created._id);
    assert.equal(fetched?.email, email);
    assert.equal(fetched?.role, "buyer");
    await query("UPDATE users SET role = 'creator' WHERE id = $1", [created._id]);
    const loggedInUser = await findUserByIdentifier(email);
    assert.equal(loggedInUser?.role, "creator");
    await assert.rejects(
      createUser({
        name: "Duplicate Email Test",
        email,
        mobile: `+1666${Date.now().toString().slice(-7)}`,
        role: "buyer",
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
    );
  } finally {
    if (createdId) await query("DELETE FROM users WHERE id = $1", [createdId]);
    await closeDatabase();
  }
});
