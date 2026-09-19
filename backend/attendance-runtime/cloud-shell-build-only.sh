#!/usr/bin/env sh
# Immutable Cloud Build + Artifact Registry publication. It never deploys or
# updates Cloud Run, calls no SQL, and sends only a clean detached checkout.
# Usage:
#   sh backend/attendance-runtime/cloud-shell-build-only.sh \
#     <GCP_PROJECT_ID> <EXPECTED_COMMIT_SHA> [BRANCH] [REPOSITORY_URL]
set -eu

project_id=${1:?GCP_PROJECT_ID is required}
expected_commit=${2:?EXPECTED_COMMIT_SHA is required}
branch=${3:-main}
repository_url=${4:-https://github.com/edgardo-may/signal-clock.git}
runtime_version=attendance-runtime-v2
runtime_capability=ACTIVE_CAPABLE
location=northamerica-south1
repository=signum-attendance
image_uri="${location}-docker.pkg.dev/${project_id}/${repository}/attendance-runtime"
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
npm ci --prefix backend --omit=dev --ignore-scripts --no-audit --no-fund
build_sha=$(node -e "require('./backend/attendance-runtime/postdeploy-readonly-check.js').runtimeSourceSha256().then(console.log)")
test -n "$build_sha"
rm -rf backend/node_modules
test -z "$(git status --porcelain)"

actual_project=$(gcloud projects describe "$project_id" --format='value(projectId)')
test "$actual_project" = "$project_id"
immutable_tags=$(gcloud artifacts repositories describe "$repository" --project "$project_id" --location "$location" --format='value(dockerConfig.immutableTags)')
case "$immutable_tags" in true|True) ;; *) echo 'Artifact Registry immutableTags must be true' >&2; exit 3 ;; esac

short_commit=$(printf '%s' "$expected_commit" | cut -c1-12)
image_tag="v2-${short_commit}"
build_id=$(gcloud builds submit --async --project "$project_id" --config backend/attendance-runtime/cloudbuild-build-only.yaml \
  --substitutions="_RUNTIME_VERSION=${runtime_version},_BUILD_SHA=${build_sha},_ATTENDANCE_RUNTIME_CAPABILITY=${runtime_capability},_IMAGE_URI=${image_uri},_IMAGE_TAG=${image_tag}" \
  --format='value(id)' .)
test -n "$build_id"
gcloud builds log --stream "$build_id" --project "$project_id"
build_status=$(gcloud builds describe "$build_id" --project "$project_id" --format='value(status)')
test "$build_status" = SUCCESS
image_digest=$(gcloud artifacts docker images describe "${image_uri}:${image_tag}" --project "$project_id" --format='value(image_summary.digest)')
case "$image_digest" in sha256:*) ;; *) echo 'Artifact Registry returned no image digest' >&2; exit 3 ;; esac

printf '%s\n' "source_commit=$expected_commit"
printf '%s\n' "runtime_version=$runtime_version"
printf '%s\n' "build_sha=$build_sha"
printf '%s\n' "image_tag=$image_tag"
printf '%s\n' "image_digest=$image_digest"
printf '%s\n' "cloud_build_id=$build_id"
printf '%s\n' "cloud_build_status=$build_status"
printf '%s\n' 'attendance_container_artifact_build=PASS'
