# SanTrack — Security & recovery checklist (Minicom IT)

Complete **before production** with real regulator / industry data.

## P0 — Account takeover (application + ops)

- [ ] `SEED_ON_START=false` and `ALLOW_DEMO_SEED=false` on every shared/prod host
- [ ] Rotate all admin and regulator passwords to ≥12 chars with letter + number
- [ ] Confirm `JWT_SECRET` is ≥32 random characters and unique per environment
- [ ] Confirm `JWT_EXPIRES_IN` is ≤ `8h` until refresh tokens / MFA ship
- [ ] Confirm HTTPS only on the public URL; no HTTP login
- [ ] Confirm `LICENSING_ENFORCEMENT=strict` (real-world gatekeeping for production)

## P0 — Network exposure

- [ ] Postgres, Redis, and object storage are **not** reachable from the public internet
- [ ] `CORS_ORIGINS` lists only the real frontend origin(s) — never `*`
- [ ] `APP_PUBLIC_URL` matches the production frontend
- [ ] Swagger (`/api-docs`) is off in production unless `ENABLE_SWAGGER=true` is intentional

## P0 — Data protection & recovery (IT owns)

- [ ] Database encryption at rest enabled (managed Postgres / disk encryption)
- [ ] Encrypted automated backups with retention ≥ 30 days
- [ ] Documented RPO / RTO (suggested: RPO ≤ 24h, RTO ≤ 8h)
- [ ] **One successful restore test** to a staging database this month
- [ ] Evidence / document storage private (Cloudinary or disk) — no public buckets
- [ ] Backup credentials separated from app deploy credentials

## P1 — Next application hardening (engineering)

- [x] MFA (TOTP) for `SYSTEM_ADMIN` and regulator accounts — enroll at `/mfa/setup`
- [x] HttpOnly Secure session cookie (`santrack_session`) + cookie auth on API
- [x] Redis-backed rate limits (falls back to memory if Redis is down)
- [x] Security event logging + optional `SECURITY_ALERT_WEBHOOK_URL` for failed login/MFA
- [x] Content-Security-Policy on API and Next.js frontend

## Demo environments only

Set both `SEED_ON_START=true` and `ALLOW_DEMO_SEED=true` only on disposable demos.
Demo passwords are public and must never appear on Minicom production hosts.
