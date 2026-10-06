# Backend testing

Run commands from the repository root:

```powershell
npm --prefix backend run build
npm --prefix backend test
npm --prefix backend run test:database
npm --prefix backend run test:load
```

`test` runs local unit and Fastify API tests with test-only configuration. It
does not connect to MongoDB, SMTP, Cloudinary, Redis, RabbitMQ, or Razorpay.

## Coverage and limits

| Test area | Current coverage |
| --- | --- |
| Unit | OTP generation/expiry, JWT verification, software/order schema validation, Razorpay signature verification |
| API and integration | Fastify injection for health/readiness, validation, CORS, errors, and authentication/role boundaries |
| Contract | Health response shape and integration status values |
| Authentication/authorization | Missing and malformed token rejection; buyer denied on creator routes |
| Security | Production JWT/CORS configuration checks, CORS behavior, security headers, schema validation |
| Smoke/health | `/health` and `/ready` behavior |
| Database | Opt-in MongoDB persistence and unique-email-index check; requires an isolated test database |
| Load/performance | Local HTTP load against health and unauthenticated protected route only |
| End-to-end | Full signup, listing, approval, purchase, and delivery flow is not covered |
| Payment | HMAC signature is unit-tested; sandbox checkout/capture/webhook is not covered |

Run the database test only with a disposable MongoDB database whose name
contains `test`. Never point it at staging or production:

```powershell
$env:MONGO_TEST_URI = "mongodb://127.0.0.1:27017/marketplace_test"
npm --prefix backend run test:database
Remove-Item Env:MONGO_TEST_URI
```

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
