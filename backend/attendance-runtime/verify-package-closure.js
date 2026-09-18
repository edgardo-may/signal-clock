'use strict'

const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

function verifyPackageClosure() {
  const dockerfile = read('backend/attendance-runtime/Dockerfile')
  const ignore = read('backend/attendance-runtime/Dockerfile.dockerignore')
  const cloudBuild = read('backend/attendance-runtime/cloudbuild-build-only.yaml')
  const cloudShellBuild = read('backend/attendance-runtime/cloud-shell-build-only.sh')
  const server = read('backend/attendance-runtime/server.js')
  const service = read('backend/attendance-runtime/AttendanceRuntimeService.js')
  assert.ok(existsSync(path.join(root, 'backend/package-lock.json')), 'backend/package-lock.json is required for npm ci')
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/)
  assert.match(dockerfile, /USER node/)
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/)
  assert.match(dockerfile, /COPY backend\/services\/attendance\/AttendanceEngineOrchestrator\.js backend\/services\/attendance\/WorkdayPersistenceContract\.js/)
  assert.match(dockerfile, /COPY src\/domain\/attendance/)
  assert.doesNotMatch(dockerfile, /COPY backend\/attendance-runtime\s+\.\/attendance-runtime/)
  assert.doesNotMatch(dockerfile, /\b(?:ADD|COPY)\s+\.\s+/)
  assert.doesNotMatch(dockerfile, /frontend|docs|tests|zkteco-push-ta|api-integracion/i)
  assert.match(ignore, /^\*\*$/m)
  for (const included of ['backend/package.json', 'backend/package-lock.json', 'backend/services/attendance/AttendanceEngineOrchestrator.js', 'backend/services/attendance/WorkdayPersistenceContract.js', 'backend/attendance-runtime/server.js', 'backend/attendance-runtime/AttendanceRuntimeService.js', 'src/domain/attendance/**']) {
    assert.match(ignore, new RegExp(`!${included.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  }
  assert.match(server, /installGracefulShutdown/)
  assert.match(service, /mode: 'SHADOW'/)
  assert.doesNotMatch(service, /WorkdayPersistenceService|PERSIST_MODE/)
  assert.match(cloudBuild, /BUILD_SHA=\$\{_BUILD_SHA\}/)
  assert.match(cloudBuild, /docker image inspect/)
  assert.match(cloudBuild, /expected_user="node"/)
  assert.match(cloudBuild, /NODE_ENV=production/)
  assert.match(cloudBuild, /RUNTIME_VERSION=\$expected_runtime_version/)
  assert.match(cloudBuild, /BUILD_SHA=\$expected_build_sha/)
  assert.match(cloudBuild, /attendance_container_build_validation=PASS/)
  assert.doesNotMatch(cloudBuild, /gcloud run|--push|images:/i)
  assert.match(cloudShellBuild, /EXPECTED_COMMIT_SHA is required/)
  assert.match(cloudShellBuild, /git checkout --detach/)
  assert.match(cloudShellBuild, /git status --porcelain/)
  assert.match(cloudShellBuild, /gcloud builds submit/)
  assert.doesNotMatch(cloudShellBuild, /gcloud run|gcloud builds submit[^\n]*--tag/i)
  return {
    package_closure_pass: true,
    runtime_files_only: true,
    node_non_root: true,
    production_dependencies_only: true,
    graceful_shutdown: true,
  }
}

if (require.main === module) console.log(JSON.stringify(verifyPackageClosure()))

module.exports = { verifyPackageClosure }
