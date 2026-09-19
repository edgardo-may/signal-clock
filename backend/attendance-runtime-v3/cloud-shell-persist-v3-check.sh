#!/usr/bin/env sh
# Run only after Phase 86. This invokes the one authorized PERSIST request.
set -eu
url=${ATTENDANCE_RUNTIME_URL:?ATTENDANCE_RUNTIME_URL is required}
token_file=${ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE:?ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE is required}
build_sha=${ATTENDANCE_RUNTIME_V3_BUILD_SHA:?ATTENDANCE_RUNTIME_V3_BUILD_SHA is required}
internal_token=$(tr -d '\r\n' < "$token_file")
identity_token=$(gcloud auth print-identity-token --audiences="$url")
health=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/health")
ready=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/ready")
printf '%s' "$health" | jq -e --arg build "$build_sha" '.status=="ok" and .runtime_version=="attendance-runtime-v3" and .build_sha==$build and .runtime_capability=="ACTIVE_PERSIST_CAPABLE" and .execution_mode=="REVISION_RESOLVER_ACTIVE_PERSIST_CAPABLE"' >/dev/null
printf '%s' "$ready" | jq -e --arg build "$build_sha" '.status=="ok" and .database=="reachable" and .runtime_version=="attendance-runtime-v3" and .build_sha==$build' >/dev/null
body=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" -H "Authorization: Bearer $internal_token" -H 'content-type: application/json' -d '{"registro_id":"5707fc4d-833a-48ab-bf49-90f5b30e0174"}' "$url/internal/attendance/persist")
printf '%s' "$body" | jq -e '.execution_mode=="ACTIVE" and .persistence_mode=="PERSIST" and .persistence_result=="UNCHANGED" and .workday_id=="5fe7ef34-7699-474b-b312-d0c5031a1fbe" and .runtime_capability=="ACTIVE_PERSIST_CAPABLE" and .engine_version=="ATTENDANCE_ENGINE_V3" and .calculation_version==3 and .assignment_id=="2984316c-1c93-4f66-853e-349f90b9f82c" and .schedule_revision_id=="09df6a75-e231-4654-ae70-8448bdf2c312" and .revision_integrity_hash=="77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866" and .databaseWrites==0 and .persistenceCalls==1 and .rpcWriteCalls==1 and .storageWriteCalls==0 and .indirectSupabaseCalls==0 and .incidentWriteCalls==0' >/dev/null
printf '%s\n' "$body"
