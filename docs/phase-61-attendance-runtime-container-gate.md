# Phase 61 — Attendance Runtime container gate

## Package audit

The container build context is repository root, but the Dockerfile-specific ignore allowlist and explicit `COPY` commands admit only:

```text
backend/package.json
backend/package-lock.json
backend/services/attendance/{AttendanceEngineOrchestrator,WorkdayPersistenceContract}.js
backend/attendance-runtime/{server,app,config,AttendanceRuntimeService,readOnlySupabase,tenantFeature,postdeploy-readonly-check}.js
src/domain/attendance/**
```

No frontend, documentation, test, ADMS, `api-integracion`, `zkteco-push-ta`, local `.env`, or arbitrary runtime-directory files enter the image. The image uses Node 22.18 Alpine, `npm ci --omit=dev --ignore-scripts`, `NODE_ENV=production`, non-root `node`, port 8088 and `STOPSIGNAL SIGTERM` with runtime graceful close.

`BUILD_SHA` is the SHA-256 from `postdeploy-readonly-check.runtimeSourceSha256()`. It covers every copied attendance-domain file, the copied backend services, the runtime code, and backend package/lock files. The Dockerfile and Docker ignore file are verified separately by package-closure tests because they are build inputs, not runtime image files. `RUNTIME_VERSION` is a human release label. Both appear in health output and must be passed explicitly during build/deploy.

## Build routes — no deploy

Preferred real validation when Docker is available locally:

```powershell
$RuntimeSha = (node -e "require('./backend/attendance-runtime/postdeploy-readonly-check.js').runtimeSourceSha256().then(console.log)").Trim()
docker build --pull --no-cache --file backend/attendance-runtime/Dockerfile --build-arg RUNTIME_VERSION=attendance-runtime-v1 --build-arg BUILD_SHA=$RuntimeSha --tag signum-attendance-runtime:validation .
docker image inspect signum-attendance-runtime:validation --format '{{.Config.User}} {{.Config.Env}}'
```

Expected: build exit code 0; inspect includes `node`, `NODE_ENV=production`, the intended `RUNTIME_VERSION` and `BUILD_SHA`. Stop on any build error. This build creates a local image only; it does not deploy, push, change tenant flags, or access production data.

Fallback real validation without local Docker, using Cloud Build only (no image push and no Cloud Run deploy):

```powershell
$RuntimeSha = (node -e "require('./backend/attendance-runtime/postdeploy-readonly-check.js').runtimeSourceSha256().then(console.log)").Trim()
gcloud builds submit --project '<GCP_PROJECT_ID>' --config backend/attendance-runtime/cloudbuild-build-only.yaml --substitutions="_RUNTIME_VERSION=attendance-runtime-v1,_BUILD_SHA=$RuntimeSha" .
```

This creates a Cloud Build record and validation image only. It must not be considered a deployment.

For Cloud Shell, use [cloud-shell-build-only.sh](/C:/Users/Edgar/signal-clock/backend/attendance-runtime/cloud-shell-build-only.sh) only after the runtime package is in a reviewed, pushed commit. It clones the requested branch, detaches at the supplied commit, rejects a dirty worktree, recomputes the SHA, validates the package closure, checks the project, and submits the build-only YAML. It contains no Cloud Run command.

## Future private Cloud Run deployment package

Do not execute until container build passes and final approval is given. Substitute only reviewed values:

```powershell
$ProjectId = '<GCP_PROJECT_ID>'
$Region = '<APPROVED_REGION>'
$Service = 'signum-attendance-runtime'
$RuntimeServiceAccount = '<RUNTIME_SERVICE_ACCOUNT_EMAIL>'
$CallerServiceAccount = '<NORMALIZER_CALLER_SERVICE_ACCOUNT_EMAIL>'
$Image = '<REGION>-docker.pkg.dev/<GCP_PROJECT_ID>/<ARTIFACT_REPOSITORY>/signum-attendance-runtime:<IMMUTABLE_TAG>'
$RuntimeVersion = '<APPROVED_RUNTIME_VERSION>'
$BuildSha = '<PACKAGE_SHA256_FROM_STAGED_ARTIFACT>'
```

The runtime service account needs only Secret Manager access to the three runtime secrets. The caller service account receives only `roles/run.invoker` on this service. Do not grant browser users, anonymous principals, Cloud Run Admin, Editor, Owner, or database mutation roles.

```powershell
gcloud run deploy $Service --project $ProjectId --region $Region --image $Image --service-account $RuntimeServiceAccount --no-allow-unauthenticated --ingress internal-and-cloud-load-balancing --port 8088 --min-instances 0 --max-instances 1 --cpu 1 --memory 512Mi --set-env-vars "NODE_ENV=production,ATTENDANCE_RUNTIME_PORT=8088,RUNTIME_VERSION=$RuntimeVersion,BUILD_SHA=$BuildSha" --set-secrets "SUPABASE_URL=<SUPABASE_URL_SECRET>:latest,SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_SERVICE_ROLE_SECRET>:latest,ATTENDANCE_RUNTIME_INTERNAL_TOKEN=<INTERNAL_TOKEN_SECRET>:latest"
gcloud run services add-iam-policy-binding $Service --project $ProjectId --region $Region --member "serviceAccount:$CallerServiceAccount" --role roles/run.invoker
```

Use a region already approved for Signum infrastructure; this repository does not establish one. Keep the service private. The bearer token remains an application-level second control even with Cloud Run IAM.

## Post-deploy sequence — not authorized yet

1. Deploy with the tenant feature absent/OFF.
2. Run the runtime postdeploy check inside the deployed runtime image with `ATTENDANCE_RUNTIME_EXPECTED_BUILD_SHA=$BuildSha` and `ATTENDANCE_RUNTIME_EXPECTED_SHA256=$BuildSha`.
3. Require health, ready, C revision/hash and every write counter to pass at zero.
4. Edgar runs fresh SQL 59 read-only.
5. Only then review Phase 60. Phase 60 remains prohibited now.

If Phase 60 is approved later, Edgar must run [64_revision_resolver_shadow_postcheck.sql](/C:/Users/Edgar/signal-clock/database/live-schema/64_revision_resolver_shadow_postcheck.sql) immediately after it. Phase 64 requires only the pilot `SHADOW` flag, C revision/hash parity, and zero `ACTIVE` tenants; it is read-only and does not authorize persistence or `ACTIVE`.
