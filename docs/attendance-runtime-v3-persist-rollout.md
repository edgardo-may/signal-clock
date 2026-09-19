# Attendance Runtime v3 controlled PERSIST canary

The existing production workday is immutable evidence. Both v3 PERSIST calls must return `UNCHANGED`; neither may create a workday or history row.

1. Build v3 and deploy it as a Cloud Run candidate at 0% traffic.
2. Check `/health` and `/ready`, then check `/internal/attendance/active` remains `READ_ONLY`.
3. Move v3 to 100% traffic; v2 must receive 0% before Phase 85.
4. Run Phase 85 and require its pass result.
5. Run Phase 86 exactly once.
6. Run `cloud-shell-persist-v3-check.sh`, paste its JSON output into Phase 87, and run Phase 87.
7. Run the same script a second time, paste its JSON output into Phase 88, and run Phase 88.
8. Run Phase 89, then Phase 90 to remove only `WORKDAY_PERSIST_CANARY`. Resolver ACTIVE remains enabled.

## Build and candidate commands

```sh
export GCP_PROJECT_ID='REPLACE_APPROVED_PROJECT_ID'
export REGION='northamerica-south1'
export IMAGE_URI="$REGION-docker.pkg.dev/$GCP_PROJECT_ID/signum-attendance/attendance-runtime"
export BUILD_SHA="$(node backend/attendance-runtime-v3/source-sha256.js)"
export IMAGE_TAG="v3-$(git rev-parse --short=12 HEAD)"
gcloud builds submit --project "$GCP_PROJECT_ID" --config backend/attendance-runtime-v3/cloudbuild-build-v3.yaml --substitutions="_RUNTIME_VERSION=attendance-runtime-v3,_BUILD_SHA=$BUILD_SHA,_IMAGE_URI=$IMAGE_URI,_IMAGE_TAG=$IMAGE_TAG" .
export IMAGE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE_URI:$IMAGE_TAG" --project "$GCP_PROJECT_ID" --format='value(image_summary.digest)')"
gcloud run deploy signum-attendance-runtime --project "$GCP_PROJECT_ID" --region "$REGION" --image "$IMAGE_URI@$IMAGE_DIGEST" --tag v3-candidate --no-traffic --update-env-vars "RUNTIME_VERSION=attendance-runtime-v3,BUILD_SHA=$BUILD_SHA,ATTENDANCE_RUNTIME_CAPABILITY=ACTIVE_PERSIST_CAPABLE"
```

`--update-env-vars` preserves the existing secret bindings and service settings. Inspect them before deployment; do not replace them with `--set-secrets` or `--set-env-vars`.

## Prepared promotion and rollback

```sh
gcloud run services update-traffic signum-attendance-runtime --project "$GCP_PROJECT_ID" --region "$REGION" --to-tags v3-candidate=100
gcloud run services update-traffic signum-attendance-runtime --project "$GCP_PROJECT_ID" --region "$REGION" --to-revisions signum-attendance-runtime-00003-5ft=100
```

The second command is the exact runtime rollback to v2. The authorization rollback is Phase 90, which removes only the exact temporary canary row.
