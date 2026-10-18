# Roadster Atelier — independent reservation demo

Independent Tesla Roadster-inspired design study. Not affiliated with Tesla, Inc. No real reservations, vehicle sales or payments. Use fictional details.

## Free hosting architecture
Render Free runs the Node.js app. Neon Free PostgreSQL stores reservations and administrator sessions separately from the web service. Render restarts and redeploys therefore do not discard database records. Free tiers have quotas and availability limits; the app can take time to wake after inactivity. Never use Render's temporary local filesystem for production reservations.

## Local use
Requires Node.js 24 and pnpm 11.19.0. Run `pnpm install --frozen-lockfile`, copy `.env.example` to `.env`, replace the password and session secret, and run `pnpm start`. Visit http://localhost:3000 and /admin.html. Without DATABASE_URL, development uses a local SQLite file.

## Deployment
1. Create a Neon Free PostgreSQL project. Save the TLS connection URL privately.
2. Create a Render Free Docker web service from this repository's main branch. Do not add a paid disk.
3. Set DATABASE_URL to the Neon connection URL, TRUST_PROXY=1, ADMIN_PASSWORD to a unique password of at least 16 characters, and SESSION_SECRET to a generated random value of at least 32 characters. Never put these secrets in GitHub.
4. Use /api/health for the health check. The Docker image sets NODE_ENV=production and HOST=0.0.0.0.
5. Deploy and use the Render HTTPS URL. Open /admin.html, username admin, and enter the password configured in Render.
6. Create a fictional reservation, update its status, restart/redeploy the Render service and verify that its reference still resolves.

Production refuses to start without DATABASE_URL. An optional ALLOW_PERSISTENT_SQLITE=1 override exists only for deployments with verified persistent local storage; do not enable it on Render Free.

## Features and security
Responsive design, fictional configurations, validated submissions, random 96-bit references, public lookup without contact data, admin search/filter/pagination/statistics/status editing and JSON backup export. PostgreSQL uses TLS certificate verification and parameterized queries. Admin cookies are HttpOnly, SameSite=Strict and Secure in production; sessions expire after eight hours. CSRF checks, request limits, security headers and no-store API responses are enabled. Health probes do not consume visitor rate limits. No analytics, outgoing email or payment integration.

## Backups and limitations
Use **Export backup** in the administrator dashboard to download reservation records as JSON. Keep copies in private storage separate from Neon. The JSON export excludes session secrets and authentication records. It is a data export, not an automatic full-database restore system. For full PostgreSQL backups and restores use pg_dump/pg_restore or the provider's supported tools. The scripts/backup.cjs utility is for local SQLite development only.

Durable storage is not a guarantee against account deletion, operator mistakes, corruption or provider policy changes. Automatic offsite backups, MFA, email verification and retention schedules are not configured. This is a demonstration, not a real customer-order platform.

## Testing
`pnpm test` checks input validation, authentication, CSRF, cookie flags, public lookup privacy, admin search, status changes, logout, unknown/private paths, repeated health probes and persistence across restart with an isolated SQLite database. Hosted PostgreSQL must also be verified after deployment. `pnpm audit --prod` scans dependencies.

## API
GET /api/health
POST /api/reservations
GET /api/reservations/:reference
POST /api/admin/login
POST /api/admin/logout
GET /api/admin/stats
GET /api/admin/export
GET /api/admin/reservations (search, status, configuration, page, limit)
PATCH /api/admin/reservations/:reference (status)
DELETE /api/admin/reservations/:reference

Admin writes require X-Requested-With: RoadsterAdmin and a session cookie, except login which creates the session. Every status, including confirmed, describes only a demo record.
