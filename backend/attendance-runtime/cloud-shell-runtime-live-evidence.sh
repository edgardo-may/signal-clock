#!/usr/bin/env sh
# Read-only Cloud Run evidence gate. Requires an already-authorized Cloud Shell
# principal and a local file containing only ATTENDANCE_RUNTIME_INTERNAL_TOKEN.
# It never changes IAM, deploys, updates a flag, or writes application data.
set -eu

project_id=${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}
token_file=${ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE:?ATTENDANCE_RUNTIME_INTERNAL_TOKEN_FILE is required}
service=signum-attendance-runtime
region=northamerica-south1
url=https://signum-attendance-runtime-3asu34tppq-pv.a.run.app
expected_revision=signum-attendance-runtime-00002-fn5
expected_digest=sha256:a04ed58d32c49a0b32314fcd88894088e20b1e8428469b68840c18d63f2f9b0e
expected_service_account=signum-attendance-runtime@project-88e975e6-b4b6-4423-a93.iam.gserviceaccount.com
expected_runtime=attendance-runtime-v1
expected_build=6a36e31633594c4b256b03b5d3ca02a72ed8874d8b941a37affa1723e34c6d66
registro_id=5707fc4d-833a-48ab-bf49-90f5b30e0174
assignment_id=2984316c-1c93-4f66-853e-349f90b9f82c
revision_id=09df6a75-e231-4654-ae70-8448bdf2c312
revision_hash=77ee547cfef3de39f6b59e4d9f531d4c29f054cc2c72bb13018a911c2c274866

test -r "$token_file"
internal_token=$(tr -d '\r\n' < "$token_file")
test -n "$internal_token"

service_json=$(gcloud run services describe "$service" --project "$project_id" --region "$region" --format=json)
revision=$(printf '%s' "$service_json" | jq -r '.status.latestReadyRevisionName')
image=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.containers[0].image')
service_account=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.serviceAccountName')
ingress=$(printf '%s' "$service_json" | jq -r '.metadata.annotations["run.googleapis.com/ingress"]')
port=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.containers[0].ports[0].containerPort')
min_instances=$(printf '%s' "$service_json" | jq -r '.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"] // "0"')
max_instances=$(printf '%s' "$service_json" | jq -r '.spec.template.metadata.annotations["autoscaling.knative.dev/maxScale"]')
concurrency=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.containerConcurrency')
env_names=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.containers[0].env[].name' | sort)
secret_key_ref=$(printf '%s' "$service_json" | jq -r '.spec.template.spec.containers[0].env[] | select(.name=="SUPABASE_SECRET_KEY") | (.valueFrom.secretKeyRef.name // .valueSource.secretKeyRef.secret // empty)')

test "$revision" = "$expected_revision"
case "$image" in *"@$expected_digest") ;; *) exit 20 ;; esac
test "$service_account" = "$expected_service_account"
test "$ingress" = internal-and-cloud-load-balancing
test "$port" = 8088
test "$min_instances" = 0
test "$max_instances" = 1
test "$concurrency" = 1
printf '%s\n' "$env_names" | grep -Fx SUPABASE_SECRET_KEY >/dev/null
test -n "$secret_key_ref"
if printf '%s\n' "$env_names" | grep -E '^SUPABASE_.*SERVICE_ROLE' >/dev/null; then exit 21; fi

# Cloud Run validates the ID token in X-Serverless-Authorization, leaving the
# normal Authorization header available to the runtime's constant-time bearer guard.
identity_token=$(gcloud auth print-identity-token --audiences="$url")
health=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/health")
ready=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" "$url/ready")
printf '%s' "$health" | jq -e --arg version "$expected_runtime" --arg build "$expected_build" '.status=="ok" and .execution_mode=="SHADOW_ONLY" and .runtime_version==$version and .build_sha==$build' >/dev/null
printf '%s' "$ready" | jq -e --arg version "$expected_runtime" --arg build "$expected_build" '.status=="ok" and .database=="reachable" and .runtime_version==$version and .build_sha==$build' >/dev/null

unauthorized_status=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Serverless-Authorization: Bearer $identity_token" -H 'content-type: application/json' -d "{\"registro_id\":\"$registro_id\"}" "$url/internal/attendance/shadow")
test "$unauthorized_status" = 401
invalid_status=$(curl -sS -o /dev/null -w '%{http_code}' -H "X-Serverless-Authorization: Bearer $identity_token" -H "Authorization: Bearer $internal_token" -H 'content-type: application/json' -d "{\"registro_id\":\"$registro_id\",\"cliente_id\":\"forbidden\"}" "$url/internal/attendance/shadow")
test "$invalid_status" = 400

shadow=$(curl -fsS -H "X-Serverless-Authorization: Bearer $identity_token" -H "Authorization: Bearer $internal_token" -H 'content-type: application/json' -d "{\"registro_id\":\"$registro_id\"}" "$url/internal/attendance/shadow")
printf '%s' "$shadow" | jq -e --arg assignment "$assignment_id" --arg revision "$revision_id" --arg hash "$revision_hash" '
  .resolution_mode=="SHADOW" and .engine_version=="ATTENDANCE_ENGINE_V3" and .calculation_version==3 and
  .assignment_id==$assignment and .schedule_revision_id==$revision and .revision_version==1 and .integrity_hash==$hash and
  .databaseWrites==0 and .persistenceCalls==0 and .rpcWriteCalls==0 and .storageWriteCalls==0 and .indirectSupabaseCalls==0 and .incidentWriteCalls==0
' >/dev/null

jq -n --arg revision "$revision" --arg image "$image" --arg service_account "$service_account" --arg ingress "$ingress" --argjson port "$port" --argjson min_instances "$min_instances" --argjson max_instances "$max_instances" --argjson concurrency "$concurrency" --argjson health "$health" --argjson ready "$ready" --argjson shadow "$shadow" '{phase:"runtime_live_evidence",read_only:true,cloud_run:{revision:$revision,image:$image,service_account:$service_account,ingress:$ingress,port:$port,min_instances:$min_instances,max_instances:$max_instances,concurrency:$concurrency},health:$health,ready:$ready,shadow:$shadow,live_runtime_evidence_pass:true,databaseWrites:0,persistenceCalls:0,rpcWriteCalls:0,storageWriteCalls:0,indirectSupabaseCalls:0,incidentWriteCalls:0}'
