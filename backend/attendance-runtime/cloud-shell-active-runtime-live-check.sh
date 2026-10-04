#!/usr/bin/env sh
# Run only after Phase 81 commits. This is an HTTP calculation check; it does
# not deploy, alter IAM, or perform database DML. The runtime itself enforces
# READ_ONLY and the command rejects any unexpected counter.
set -eu

url=${ATTENDANCE_RUNTIME_URL:?ATTENDANCE_RUNTIME_URL is required}
token_file=${ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE:?ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE is required}
registro_id=5707fc4d-833a-48ab-bf49-90f5b30e0174
assignment_id=2984316c-1c93-4f66-853e-349f90b9f82c
revision_id=09df6a75-e231-4654-ae70-8448bdf2c312
revision_hash=77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866
runtime_version=attendance-runtime-v2
build_sha=04870632cfeca1b5a3542852a602f030a65b9e7eb19191e33b5351999dba9933

test -r "$token_file"
internal_token=$(tr -d '\r\n' < "$token_file")
test -n "$internal_token"
identity_token=$(gcloud auth print-identity-token --audiences="$url")

health=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/health")
ready=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/ready")
printf '%s' "$health" | jq -e --arg runtime "$runtime_version" --arg build "$build_sha" '.status=="ok" and .runtime_version==$runtime and .build_sha==$build and .execution_mode=="REVISION_RESOLVER_ACTIVE_CAPABLE_READ_ONLY" and .runtime_capability=="ACTIVE_CAPABLE" and (.resolution_modes|sort)==["ACTIVE","SHADOW"]' >/dev/null
printf '%s' "$ready" | jq -e --arg runtime "$runtime_version" --arg build "$build_sha" '.status=="ok" and .database=="reachable" and .runtime_version==$runtime and .build_sha==$build' >/dev/null

body=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" -H "Authorization: Bearer $internal_token" -H 'content-type: application/json' -d "{\"registro_id\":\"$registro_id\"}" "$url/internal/attendance/active")
printf '%s' "$body" | jq -e --arg runtime "$runtime_version" --arg build "$build_sha" --arg assignment "$assignment_id" --arg revision "$revision_id" --arg hash "$revision_hash" '
  .registro_id=="5707fc4d-833a-48ab-bf49-90f5b30e0174" and
  .execution_mode=="ACTIVE" and .persistence_mode=="READ_ONLY" and .resolution_mode=="ACTIVE" and
  .runtime_capability=="ACTIVE_CAPABLE" and .engine_version=="ATTENDANCE_ENGINE_V3" and .calculation_version==3 and
  .assignment_id==$assignment and .schedule_revision_id==$revision and .revision_integrity_hash==$hash and .integrity_hash==$hash and
  .databaseWrites==0 and .persistenceCalls==0 and .rpcWriteCalls==0 and .storageWriteCalls==0 and .indirectSupabaseCalls==0 and .incidentWriteCalls==0
' >/dev/null

jq -n --argjson health "$health" --argjson ready "$ready" --argjson active "$body" '{phase:"active_runtime_live_check",health:$health,ready:$ready,active:$active,active_runtime_live_check_pass:true}'
