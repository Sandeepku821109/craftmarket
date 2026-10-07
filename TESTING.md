# Backend testing

Run commands from the repository root:

```powershell
npm --prefix backend run build
npm --prefix backend test
npm --prefix backend run test:database
npm --prefix backend run test:load
```

`test` runs local unit and Fastify API tests with test-only configuration. It
does not connect to PostgreSQL, SMTP, Cloudinary, Redis, RabbitMQ, or Razorpay.

## Coverage and limits

| Test area | Current coverage |
| --- | --- |
| Unit | OTP generation/expiry, JWT verification, PostgreSQL schema constraints, Razorpay signature verification |
| API and integration | Fastify injection for health/readiness, validation, CORS, errors, and authentication/role boundaries |
| Contract | Health response shape and integration status values |
| Authentication/authorization | Missing and malformed token rejection; buyer denied on creator routes |
| Security | Production JWT/CORS configuration checks, CORS behavior, security headers, schema validation |
| Smoke/health | `/health` and `/ready` behavior |
| Database | Opt-in PostgreSQL persistence and unique-email constraint check; requires an isolated test database |
| Load/performance | Local HTTP load against health and unauthenticated protected route only |
| End-to-end | Full signup, listing, approval, purchase, and delivery flow is not covered |
| Payment | HMAC signature is unit-tested; sandbox checkout/capture/webhook is not covered |

Run the database test only with a disposable PostgreSQL database whose name
contains `test`. Never point it at staging or production:

```powershell
$env:DATABASE_TEST_URL = "postgresql://user:password@host/marketplace_test?sslmode=require"
npm --prefix backend run test:database
Remove-Item Env:DATABASE_TEST_URL
```

The backend initializes its PostgreSQL tables from `src/config/schema.ts` at
startup. Configure `DATABASE_URL` with the Neon connection string from the
Neon dashboard. To copy existing MongoDB records once, set `MONGO_SOURCE_URI`
locally and run `npm --prefix backend run migrate:neon`; verify the reported
record totals before switching traffic. The migration preserves existing
24-character document IDs and skips rows already imported.

Product PDFs, images, and videos are uploaded to Cloudinary. Admin PDF previews
stream through the authenticated backend endpoint.

The local load test defaults to 10 workers for 10 seconds. It is capped at 50
workers and 60 seconds and does not exercise database-backed endpoints or
external providers. For example:

```powershell
$env:LOAD_CONCURRENCY = "20"
$env:LOAD_DURATION_SECONDS = "30"
npm --prefix backend run test:load
Remove-Item Env:LOAD_CONCURRENCY
Remove-Item Env:LOAD_DURATION_SECONDS
```

Before production, run full workflow and payment tests in an isolated staging
environment using sandbox payment credentials, a test database, and test email
and upload services. Load-test the deployed environment against an agreed
traffic target and verify backups, alerts, and recovery procedures.
