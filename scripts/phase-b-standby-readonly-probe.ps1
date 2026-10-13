param([Parameter(Mandatory=$true)][switch]$BeforeSqlConfirmed,[switch]$ResumeAfterHealth,[switch]$AuthorizedPersistOnce,[switch]$AuthorizedReplayOnce)
$ErrorActionPreference='Stop'
$gcloud='C:\Users\Edgar\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$common=@('--project','project-88e975e6-b4b6-4423-a93','--region','northamerica-south1')
$evidence=Join-Path $PSScriptRoot '../.runtime-evidence'
if (($AuthorizedPersistOnce -and $AuthorizedReplayOnce) -or (($AuthorizedPersistOnce -or $AuthorizedReplayOnce) -and $ResumeAfterHealth)) { throw 'INCOMPATIBLE_ACTIONS' }
$persistSentinel=Join-Path $evidence 'phase-b-first-persist-attempted.lock'
if ($AuthorizedPersistOnce -and (Test-Path -LiteralPath $persistSentinel)) { throw 'PERSIST_ALREADY_ATTEMPTED_DO_NOT_RETRY' }
$replaySentinel=Join-Path $evidence 'phase-b-identical-replay-attempted.lock'
if ($AuthorizedReplayOnce -and (!(Test-Path -LiteralPath $persistSentinel) -or (Test-Path -LiteralPath $replaySentinel))) { throw 'REPLAY_NOT_ELIGIBLE_OR_ALREADY_ATTEMPTED' }
function Cloud([string[]]$Arguments) {
 $result=& $gcloud @Arguments
 if ($LASTEXITCODE -ne 0) { throw 'GCLOUD_FAILED' }
 return $result
}
function State {
 $s=(Cloud (@('run','services','describe','signum-attendance-runtime')+$common+@('--format=json'))) | ConvertFrom-Json
 foreach ($entries in @($s.spec.traffic,$s.status.traffic)) {
  $positive=@($entries | Where-Object { $_.percent -gt 0 })
  if ($positive.Count -ne 1 -or $positive[0].revisionName -ne 'signum-attendance-runtime-00016-fav' -or $positive[0].percent -ne 100) { throw 'TRAFFIC_INVARIANT_FAILED' }
 }
 $d=(Cloud (@('run','jobs','describe','signum-attendance-persist-dispatcher')+$common+@('--format=json'))) | ConvertFrom-Json
 if ($d.status.executionCount -ne 7) { throw 'DISPATCHER_COUNT_CHANGED' }
 return $s
}
function ProbeJob {
 $j=(Cloud (@('run','jobs','describe','signum-attendance-runtime-probe')+$common+@('--format=json'))) | ConvertFrom-Json
 if ($j.spec.template.spec.taskCount -ne 1 -or $j.spec.template.spec.template.spec.maxRetries -ne 0) { throw 'PROBE_NOT_SINGLE_SHOT' }
 return $j
}
$before=State
if (@($before.status.traffic | Where-Object tag -eq 'phase-b-standby').Count) { throw 'TEMP_TAG_ALREADY_EXISTS' }
$jobBefore=ProbeJob
if (@($jobBefore.spec.template.spec.template.spec.containers[0].env | Where-Object name -eq 'ATTENDANCE_RUNTIME_INTERNAL_TOKEN').Count) { throw 'TEMP_MAPPING_ALREADY_EXISTS' }
$jobBefore | ConvertTo-Json -Depth 60 | Set-Content -Encoding UTF8 (Join-Path $evidence 'phase-b-probe-job-before.json')
$tagAttempted=$false
$mappingAttempted=$false
try {
 $tagAttempted=$true
 $null=Cloud (@('run','services','update-traffic','signum-attendance-runtime')+$common+@('--update-tags=phase-b-standby=signum-attendance-runtime-00013-hwb','--format=value(status.url)'))
 $state=State
 $target=($state.status.traffic | Where-Object tag -eq 'phase-b-standby')
 if ($target.revisionName -ne 'signum-attendance-runtime-00013-hwb' -or $target.percent -gt 0 -or !$target.url) { throw 'TAG_TARGET_INVALID' }
 $mappingAttempted=$true
 $null=Cloud (@('run','jobs','update','signum-attendance-runtime-probe')+$common+@('--update-secrets=ATTENDANCE_RUNTIME_INTERNAL_TOKEN=signum-attendance-internal-token:1','--format=value(metadata.name)'))
 $mapped=ProbeJob
 $mapping=@($mapped.spec.template.spec.template.spec.containers[0].env | Where-Object name -eq 'ATTENDANCE_RUNTIME_INTERNAL_TOKEN')
 if ($mapping.Count -ne 1 -or $mapping[0].valueFrom.secretKeyRef.name -ne 'signum-attendance-internal-token' -or $mapping[0].valueFrom.secretKeyRef.key -ne '1') { throw 'SECRET_MAPPING_INVALID' }
 $actions=@('health','ready','active')
 if ($ResumeAfterHealth) { $actions=@('ready','active') }
 if ($AuthorizedPersistOnce -or $AuthorizedReplayOnce) { $actions=@('persist') }
 foreach ($action in $actions) {
  $null=State
  $shell=@'
set -eu
BASE_URL="__BASE__"
TARGET_URL="__TARGET__/__PATH__"
TOKEN="$(curl -sS --max-time 20 -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${BASE_URL}")"
test -n "$TOKEN"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
__REQUEST__
printf 'HTTP_STATUS=%s\n' "$STATUS"
cat "$BODY"
printf '\n'
test "$STATUS" = 200
__ASSERTIONS__
'@
  $request='STATUS="$(curl -sS --max-time 90 -o "$BODY" -w ''%{http_code}'' -H "X-Serverless-Authorization: Bearer ${TOKEN}" "$TARGET_URL")"'
  $assertions=@'
grep -Eq '"build_sha"[[:space:]]*:[[:space:]]*"39da4ef4885d0d8637ebf1c7c032e4984f2afa04"' "$BODY"
grep -Eq '"runtime_capability"[[:space:]]*:[[:space:]]*"REVISION_AWARE_V3_ONLY"' "$BODY"
'@
  $path=$action
  if ($action -eq 'ready') { $assertions += "`ngrep -Eq '"+'"database"[[:space:]]*:[[:space:]]*"reachable"'+"' "+'"$BODY"' }
  if ($action -eq 'active' -or $action -eq 'persist') {
   $path="internal/attendance/$action"
   $request='STATUS="$(curl -sS --max-time 90 -o "$BODY" -w ''%{http_code}'' -X POST -H "Content-Type: application/json" -H "X-Serverless-Authorization: Bearer ${TOKEN}" -H "Authorization: Bearer ${ATTENDANCE_RUNTIME_INTERNAL_TOKEN}" --data ''{"registro_id":"7c4fd4f1-5c04-4dcc-badd-8ec65ef5ec6d"}'' "$TARGET_URL")"'
   $assertions=@'
grep -Eq '"persistence_mode"[[:space:]]*:[[:space:]]*"READ_ONLY"' "$BODY"
for field in persistenceCalls databaseWrites rpcWriteCalls storageWriteCalls incidentWriteCalls; do
 grep -Eq "\"${field}\"[[:space:]]*:[[:space:]]*0([,}])" "$BODY"
done
grep -Eq '"runtime_deployment_capability"[[:space:]]*:[[:space:]]*"REVISION_AWARE_V3_ONLY"' "$BODY"
grep -Eq '"tenant_id"[[:space:]]*:[[:space:]]*"3a4b9110-74c6-47f8-bd06-6b099834cf7f"' "$BODY"
grep -Eq '"employee_id"[[:space:]]*:[[:space:]]*"577c199c-b787-4f06-b7c7-685e84f8e0ad"' "$BODY"
grep -Eq '"schedule_revision_id"[[:space:]]*:[[:space:]]*"fae2ab33-61fa-419b-91c3-1dfb573c6142"' "$BODY"
grep -Eq '"operative_date"[[:space:]]*:[[:space:]]*"2026-10-10"' "$BODY"
grep -Eq '"revision_integrity_hash"[[:space:]]*:[[:space:]]*"61b220e727fb7c665ca126b8d6db07087de963cf65a4281e585322fd39daa5c7"' "$BODY"
'@
   if ($action -eq 'persist') {
    $assertions=$assertions.Replace('"READ_ONLY"','"PERSIST"')
    $assertions=$assertions.Replace('for field in persistenceCalls databaseWrites rpcWriteCalls storageWriteCalls incidentWriteCalls; do','for field in storageWriteCalls incidentWriteCalls; do')
    $assertions += @'

grep -Eq '"persistence_result"[[:space:]]*:[[:space:]]*"INSERTED"' "$BODY"
for field in persistenceCalls databaseWrites rpcWriteCalls; do
 grep -Eq "\"${field}\"[[:space:]]*:[[:space:]]*1([,}])" "$BODY"
done
'@
    if ($AuthorizedReplayOnce) {
     $assertions=$assertions.Replace('"INSERTED"','"UNCHANGED"')
     $assertions=$assertions.Replace('for field in persistenceCalls databaseWrites rpcWriteCalls; do','for field in persistenceCalls rpcWriteCalls; do')
     $assertions += @'

grep -Eq '"databaseWrites"[[:space:]]*:[[:space:]]*0([,}])' "$BODY"
grep -Eq '"workday_id"[[:space:]]*:[[:space:]]*"b26b19af-da82-49e1-9f50-79280e1b4726"' "$BODY"
'@
    }
   }
  }
  $shell=$shell.Replace('__BASE__',$state.status.url).Replace('__TARGET__',$target.url).Replace('__PATH__',$path).Replace('__REQUEST__',$request).Replace('__ASSERTIONS__',$assertions).Replace("`r`n","`n")
  $flagPath=Join-Path $evidence "phase-b-$action-flags.json"
  [IO.File]::WriteAllText($flagPath,(@{'--args'=@('-c',$shell)} | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  # Exactly one execution, no retries, one HTTP request to the authorized endpoint.
  if ($action -eq 'persist') {
   if ((Get-FileHash (Join-Path $PSScriptRoot '../database/live-schema/ops/attendance_surcacen_oct10_rpc20_input.json') -Algorithm SHA256).Hash -ne 'B7E45118E36BD60F11EDED47226ED62370CD91FB6DEAEAE67C771ED69036F3C3') { throw 'FROZEN_ORACLE_CHANGED' }
   $attemptPath=$persistSentinel
   if ($AuthorizedReplayOnce) { $attemptPath=$replaySentinel }
   $attemptFile=[IO.File]::Open($attemptPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   $attemptFile.Dispose()
   # Never remove this sentinel, including on timeout or failure.
  }
  $execution=Cloud (@('run','jobs','execute','signum-attendance-runtime-probe')+$common+@("--flags-file=$flagPath",'--wait','--format=value(metadata.name)'))
  $executionEvidenceName="phase-b-$action-execution.txt"
  if ($AuthorizedReplayOnce) { $executionEvidenceName='phase-b-replay-execution.txt' }
  $execution | Set-Content (Join-Path $evidence $executionEvidenceName)
  Write-Output "PROBE $action EXECUTION $execution"
  Cloud @('logging','read','resource.type=cloud_run_job AND resource.labels.job_name=signum-attendance-runtime-probe','--project','project-88e975e6-b4b6-4423-a93','--freshness=20m','--limit=30','--format=json(timestamp,labels,textPayload,jsonPayload)')
 }
} finally {
 $cleanupErrors=@()
 if ($mappingAttempted) { try { $null=Cloud (@('run','jobs','update','signum-attendance-runtime-probe')+$common+@('--remove-secrets=ATTENDANCE_RUNTIME_INTERNAL_TOKEN','--format=value(metadata.name)')) } catch { $cleanupErrors += 'SECRET_CLEANUP_FAILED' } }
 if ($tagAttempted) { try { $null=Cloud (@('run','services','update-traffic','signum-attendance-runtime')+$common+@('--remove-tags=phase-b-standby','--format=value(status.url)')) } catch { $cleanupErrors += 'TAG_CLEANUP_FAILED' } }
 $final=State
 $jobAfter=ProbeJob
 if (@($final.status.traffic | Where-Object tag -eq 'phase-b-standby').Count) { $cleanupErrors += 'TAG_STILL_PRESENT' }
 if (@($jobAfter.spec.template.spec.template.spec.containers[0].env | Where-Object name -eq 'ATTENDANCE_RUNTIME_INTERNAL_TOKEN').Count) { $cleanupErrors += 'SECRET_MAPPING_STILL_PRESENT' }
 $jobAfter | ConvertTo-Json -Depth 60 | Set-Content -Encoding UTF8 (Join-Path $evidence 'phase-b-probe-job-after.json')
 $final.status.traffic | Select-Object revisionName,percent,tag | ConvertTo-Json
 if ($cleanupErrors.Count) { throw ($cleanupErrors -join ',') }
 Write-Output 'CLEANUP VERIFIED: tag removed, secret mapping removed, traffic preserved, dispatcher=7'
}
