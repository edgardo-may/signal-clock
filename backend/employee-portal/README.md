# Employee portal candidate

Candidate code + rollback-only DBREAL SQL. WEB_CLOCK passed the local closure matrix; this candidate has not been applied to production and still requires the normal release authorization.

The Portal Empresa keeps Supabase Auth. This endpoint uses a separate opaque HttpOnly cookie, hashed sessions in a private schema, and a backend-only RPC. Do not expose service credentials or the rate pepper through VITE variables. The JSON response contains display data, never the cookie token or PIN.

For local development, copy `environment.example` to `.env.employee.local`, fill the local service key and a random pepper of at least 32 characters, and run:

```powershell
node --env-file=.env.employee.local backend/employee-portal/local-server.mjs
npm run dev
```

Use the configured origin exactly. Insecure cookies are allowed only by the explicit local flag on loopback outside production. Production requires HTTPS, a single canonical origin, and no local flag.

Validate from the repository root:

```powershell
node scripts/validate-employee-local.mjs
npm test
npm run build
git diff --check
```

The runner uses only fixed Docker loopback DBREAL targets, serializes the suites, requires zero skips, and saves counts/TAP under `outputs`. The current closure run completed with 230 PASS, 0 FAIL and 0 SKIPS. Tests rollback their fixtures; they do not install the candidate persistently.

Do not apply historical migrations. Structural SQL, separate credential conversion and read-only precheck live under `database/live-schema/proposals`. Credential conversion must be scoped explicitly to one Empresa and rejects legacy PINs that need a reset. Never enable a fallback to plaintext login or browser-supplied identity.
