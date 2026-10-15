# 07 — Deployment

**Estado:** deployment units IMPLEMENTADOS; current production state VALIDADO (operator-reported, not rechecked).

The root Vercel project serves the Vite frontend and `api/employee.js`. `vercel.json` forwards `/api/sync/*` to Consolide integration. `backend/api-integracion`, `backend/signum-api`, `backend/attendance-runtime-v3`, and `backend/attendance-persist-dispatcher` have independent package/build boundaries. Promoting the root branch does not by itself prove those services were deployed.

Operator-reported snapshot: Vercel READY at `bf376f292c47cc6c4d318a5018c1e70692a547ea`; Cloud Run `bf376f2-main` at 100% with health/ready PASS; Employee API/UI maintenance ON. Do not use this page as an execution runbook without fresh approval and state checks.
