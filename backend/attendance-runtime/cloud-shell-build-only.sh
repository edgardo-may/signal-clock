#!/usr/bin/env sh
# Usage:
#   sh backend/attendance-runtime/cloud-shell-build-only.sh \
#     <GCP_PROJECT_ID> <EXPECTED_COMMIT_SHA> [BRANCH] [REPOSITORY_URL]
# This script validates an already-pushed immutable commit. It never deploys.
set -eu

project_id=${1:?GCP_PROJECT_ID is required}
expected_commit=${2:?EXPECTED_COMMIT_SHA is required}
branch=${3:-main}
repository_url=${4:-https://github.com/edgardo-may/signal-clock.git}
workspace_dir=$(mktemp -d "${TMPDIR:-/tmp}/signal-clock-attendance-build.XXXXXX")
git clone --filter=blob:none --branch "$branch" "$repository_url" "$workspace_dir"
cd "$workspace_dir"
git fetch origin "$expected_commit"
git checkout --detach "$expected_commit"

test "$(git rev-parse HEAD)" = "$expected_commit"
git merge-base --is-ancestor "$expected_commit" "origin/$branch"
test -z "$(git status --porcelain)"

node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (major < 22 || (major === 22 && minor < 18)) process.exit(1)"
test -f backend/attendance-runtime/Dockerfile
test -f backend/attendance-runtime/cloudbuild-build-only.yaml
test -f backend/attendance-runtime/postdeploy-readonly-check.js
test -f backend/attendance-runtime/verify-package-closure.js

node backend/attendance-runtime/verify-package-closure.js
build_sha="$(node -e \"require('./backend/attendance-runtime/postdeploy-readonly-check.js').runtimeSourceSha256().then(console.log)\")"
test -n "$build_sha"

gcloud projects describe "$project_id" --format='value(projectId)'
gcloud builds submit --project "$project_id" --config backend/attendance-runtime/cloudbuild-build-only.yaml --substitutions="_RUNTIME_VERSION=attendance-runtime-v1,_BUILD_SHA=$build_sha" .

printf '%s\n' "expected_commit=$expected_commit"
printf '%s\n' "build_sha=$build_sha"
printf '%s\n' 'attendance_container_build_only_submitted=PASS'
