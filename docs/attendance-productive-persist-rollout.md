# Attendance productive persistence rollout

This runbook is deliberately inert until an approved production window. The
canonical input is a linked physical `registro_asistencia`; the worker sends
only its `registro_id` to Attendance Runtime v3.

## Architecture

`ZKTeco ATTLOG -> attendance_source_events -> link_attendance_source_event -> registro_asistencia.source_event_id -> attendance_persist_outbox -> Cloud Run Job -> /internal/attendance/persist`.

The database trigger only writes the transactional outbox; it never invokes
HTTP. The worker uses its Cloud Run service account's metadata identity for
`run.invoker` and receives `ATTENDANCE_RUNTIME_INTERNAL_TOKEN` from Secret
Manager as an environment secret. It must have no browser route, public
ingress, temporary file token, or user credential.

## Required service identities

Create or use a dedicated job service account, grant it only `roles/run.invoker`
on `signum-attendance-runtime`, and grant it `roles/secretmanager.secretAccessor`
only on the managed internal-token secret. The runtime service itself remains
non-public. The Supabase service-role secret and internal token are injected as
managed Cloud Run Job secrets, never command-line values.

## Approved sequence

1. Execute `91_productive_persist_outbox_precheck.sql` read-only; require pass.
2. Deploy the runtime-v3 image containing `WORKDAY_PERSIST_ACTIVE` support as a
   candidate, validate health/ready and `ACTIVE + READ_ONLY`; do not change
   traffic until approved.
3. Apply `92_productive_persist_outbox_contract_change.sql`; it leaves the
   authorization closed and creates no business workday.
4. Deploy the dispatcher as a Cloud Run Job with the dedicated identity. Run it
   once while authorization is closed; it must claim zero rows.
5. Re-run Phase 91's equivalent closed-gate checks, then execute exactly
   `93_productive_persist_pilot_authorization_change.sql` to enable only tenant
   `69095bd5-fee5-4237-a1a4-186dd88310ff`.
6. Execute the job. For a new canonical physical record expect `INSERTED`; a
   retried record or an additional record that produces the identical logical
   day may return `UNCHANGED`.
7. Run `94_productive_persist_pilot_authorization_postcheck.sql` read-only.

## Exact emergency authorization rollback

Run `database/live-schema/95_productive_persist_pilot_authorization_rollback.sql`.
It deletes exactly the pilot `WORKDAY_PERSIST_ACTIVE` row and changes neither
the revision resolver nor workday/history data. A leased job call then fails at
both runtime and RPC authorization boundaries; retrying it is idempotent.

## Dispatcher image build (prepared; do not run without approval)

```sh
gcloud builds submit --config backend/attendance-persist-dispatcher/cloudbuild.yaml --substitutions _IMAGE_URI=REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/signum-attendance-persist-dispatcher,_IMAGE_TAG=COMMIT_SHA .
```

The final Cloud Run Job deployment must bind secrets by reference and set
`ATTENDANCE_RUNTIME_URL` to the private runtime URL; do not pass either secret
as a literal flag. The caller service account needs `run.invoker` only for the
runtime service, not project-wide invocation permission.
