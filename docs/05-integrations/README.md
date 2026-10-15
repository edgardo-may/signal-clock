# 05 — Integrations

**Estado:** IMPLEMENTADO (boundaries identified from source/docs).

- **ZKTeco ADMS:** physical gateway is external (`zkteco-push-ta`); Signal Clock retains biometrics UI and data contracts.
- **Consolide:** `backend/api-integracion`; root `vercel.json` rewrites `/api/sync/*` to the integration deployment.
- **Supabase:** public client for frontend; Employee privileged access is server-side through `SUPABASE_SECRET_KEY`; production Employee RPC availability is BLOQUEADO per operator report.
- **Cloud Run:** runtime v3 and dispatcher are separate services/build units; see deployment documentation.

Do not copy gateway code into this repository or conflate Consolide integration with `backend/signum-api`.
