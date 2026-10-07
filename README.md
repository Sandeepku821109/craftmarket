# craftmarket

## Deploying the backend to Vercel

Set the Vercel project's Root Directory to `backend`. The catch-all function in
`api/[...path].ts` forwards `/api/*` requests to the existing Fastify app.
`/health` and `/ready` are rewritten to that function as well. Keep the
standalone `npm start` command for server platforms that run a persistent
process.

Set these environment variables in Vercel for Production (and Preview if
needed):

- `DATABASE_URL`
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (different values, at least
  32 characters each in production)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`
- `CORS_ORIGINS` as a comma-separated list of HTTPS frontend origins, without
  paths (for example, `https://example.com,https://admin.example.com`)

Vercel sets `NODE_ENV` automatically. `REDIS_URL`, `RABBITMQ_URL`, and
`COOKIE_DOMAIN` are optional. Do not commit real environment values; configure
them in Vercel's project settings.