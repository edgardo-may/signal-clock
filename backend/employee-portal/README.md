# Employee portal serverless API

`api/employee.js` is the Vercel Function entry point. It delegates every request to `backend/employee-portal/http.mjs`; login, hashed server-side sessions, authorization, rate limiting, WEB_CLOCK checks, idempotency, and attendance evidence remain in the existing HTTP handler and `fn_employee_portal` SQL contract. The function is stateless between invocations. Session rows and revocation state live in `employee_private.sessions`; the browser holds only the opaque token in an HttpOnly cookie.

The API supports `GET /api/employee?action=directory`, `GET /api/employee?action=session`, and `POST` actions `login`, `logout`, and `punch`. The API returns only the company directory fields selected by the existing RPC. It never returns employee PINs, hashes, session tokens, or service credentials. Mutations require same-origin requests with JSON bodies. Identity and authoritative attendance time are derived server-side.

For local end-to-end development, copy `environment.example` to the repository-root `.env.local`, fill the local Supabase service key and a random Employee rate pepper of at least 32 characters, and set `EMPLOYEE_ORIGIN` to the exact Vercel Dev origin. Keep secrets in server-only variables; never use a `VITE_` prefix for Supabase keys or the rate pepper. Then run:

```powershell
npx vercel dev
```

Vercel Dev serves the frontend and `/api/employee` from one origin. `npm run dev` remains available for frontend-only work. End-to-end Employee testing uses Vercel Dev on the same origin. Local HTTP cookies are allowed only on loopback when `EMPLOYEE_ALLOW_INSECURE_LOOPBACK_COOKIE=true`; production requires HTTPS and Secure cookies.

For a coordinated release window, set `EMPLOYEE_PORTAL_MAINTENANCE=true` on the API and `VITE_EMPLOYEE_PORTAL_MAINTENANCE=true` for the frontend build. The API returns HTTP 503 before validating backend environment or contacting Supabase, while all Employee routes display the maintenance state. This gate leaves tenant administration, Central, physical devices, Attendance, and Workday routes unaffected. Deploy both maintenance-enabled components before applying Employee SQL, then deploy them with the flag off to restore access.

Validate the shared handler and regressions from the repository root:

```powershell
node --test tests/compliance/employee-http.test.js tests/compliance/employee-portal-maintenance.test.js
node scripts/validate-employee-local.mjs
npm test
npm run build
git diff --check
```

The Employee release matrix uses guarded local DBREAL tests and rolls back candidate fixtures and schema changes. Do not apply the candidate SQL to production or enable plaintext PIN fallback.
