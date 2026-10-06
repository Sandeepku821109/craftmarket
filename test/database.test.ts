import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { configureTestEnvironment } from "./testEnvironment";

configureTestEnvironment();
const mongoUri = process.env.MONGO_TEST_URI;

if (mongoUri) {
  let databaseName: string;
  try {
    const parsed = new URL(mongoUri);
    if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") {
      throw new Error();
    }
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("MONGO_TEST_URI must be a valid MongoDB connection URL");
  }
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(databaseName)) {
    throw new Error("MONGO_TEST_URI must target a database whose name clearly contains 'test'");
  }
}

test("MongoDB persists user records and enforces unique email indexes", {
  skip: !mongoUri && "Set MONGO_TEST_URI to an isolated database ending in a test name",
}, async () => {
  const mongoose = await import("mongoose");
  const { UserModel } = await import("../src/models/User.model");
  const unique = randomUUID();
  const email = `integration-${unique}@example.invalid`;
  const mobile = `+1555${Date.now().toString().slice(-7)}`;

  await mongoose.default.connect(mongoUri!);
  try {
    await UserModel.init();
    const created = await UserModel.create({
      name: "Database Integration Test",
      email,
      mobile,
      role: "buyer",
      isVerified: true,
    });
    const fetched = await UserModel.findById(created._id);
    assert.equal(fetched?.email, email);
    assert.equal(fetched?.role, "buyer");
    await assert.rejects(
      UserModel.create({
        name: "Duplicate Email Test",
        email,
        mobile: `+1666${Date.now().toString().slice(-7)}`,
        role: "buyer",
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
    );
    await UserModel.deleteOne({ _id: created._id });
  } finally {
    await UserModel.deleteOne({ email });
    await mongoose.default.disconnect();
  }
});
