# Attendance Runtime v2 — ACTIVE pilot rollout

This runbook intentionally stops before every mutating production command. The only permitted database mutation is Phase 81 after all prior gates pass.

1. Confirm the pilot is still `SHADOW` and all active tenants are zero (Phase 80 has the authoritative database check).
2. Move Cloud Run traffic to v2 only, using the exact command in the handoff below. Do not activate while `signum-attendance-runtime-00002-fn5` is receiving traffic.
3. Validate v2 on the normal service URL: `/health`, `/ready`, unauthorised request, invalid body, and `/internal/attendance/shadow`.
4. Run `80_revision_resolver_active_runtime_final_precheck.sql` in the production SQL editor; require `active_runtime_final_precheck_pass=true` and no failed checks.
5. Run `81_revision_resolver_active_change.sql`; it is the sole SHADOW-to-ACTIVE database change and must affect exactly one feature row.
6. Run `backend/attendance-runtime/cloud-shell-active-runtime-live-check.sh` with `ATTENDANCE_RUNTIME_URL` and a local `ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE`; require exit 0.
7. Run `82_revision_resolver_active_postcheck.sql`; require `active_postcheck_pass=true` and no failed checks.
8. On any failure in steps 5–7, immediately run Phase 83, then Phase 84; do not retry ACTIVE.

## Read-only Cloud Run inspection commands

Set `GCP_PROJECT_ID` to the approved project ID. These commands query state only.

```sh
gcloud projects describe "$GCP_PROJECT_ID" --format='json(projectId,projectNumber,name)'
gcloud run services describe signum-attendance-runtime --project "$GCP_PROJECT_ID" --region northamerica-south1 --format=json
gcloud run revisions list --service signum-attendance-runtime --project "$GCP_PROJECT_ID" --region northamerica-south1 --format='table(metadata.name,status.conditions[0].status,status.imageDigest)'
gcloud run revisions describe signum-attendance-runtime-00003-5ft --project "$GCP_PROJECT_ID" --region northamerica-south1 --format=json
gcloud run revisions describe signum-attendance-runtime-00002-fn5 --project "$GCP_PROJECT_ID" --region northamerica-south1 --format=json
gcloud run services get-iam-policy signum-attendance-runtime --project "$GCP_PROJECT_ID" --region northamerica-south1 --format=json
```

Require v2 digest `sha256:d5a136b800cfcb340c03ff23a6fb1707726be35160575f4d7be05af2e5650e21`, v1 rollback digest `sha256:a04ed58d32c49a0b32314fcd88894088e20b1e8428469b68840c18d63f2f9b0e`, service account `signum-attendance-runtime@project-88e975e6-b4b6-4423-a93.iam.gserviceaccount.com`, ingress `internal-and-cloud-load-balancing`, v2 environment capability `ACTIVE_CAPABLE`, and no `allUsers`/`allAuthenticatedUsers` invoker binding.

## Prepared, not executed commands

Promote only v2 traffic:

```sh
gcloud run services update-traffic signum-attendance-runtime --project "$GCP_PROJECT_ID" --region northamerica-south1 --to-revisions signum-attendance-runtime-00003-5ft=100
```

Immediate runtime rollback only (does not alter the tenant feature flag):

```sh
gcloud run services update-traffic signum-attendance-runtime --project "$GCP_PROJECT_ID" --region northamerica-south1 --to-revisions signum-attendance-runtime-00002-fn5=100
```
