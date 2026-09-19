# Build from repository root:
# docker build -f backend/attendance-runtime/Dockerfile -t signum-attendance-runtime:local .
FROM node:22.18-alpine AS runtime

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY backend/services/attendance/AttendanceEngineOrchestrator.js backend/services/attendance/WorkdayPersistenceContract.js ./services/attendance/
COPY backend/attendance-runtime/server.js backend/attendance-runtime/app.js backend/attendance-runtime/config.js ./attendance-runtime/
COPY backend/attendance-runtime/AttendanceRuntimeService.js backend/attendance-runtime/readOnlySupabase.js backend/attendance-runtime/tenantFeature.js ./attendance-runtime/
COPY backend/attendance-runtime/postdeploy-readonly-check.js ./attendance-runtime/
COPY src/domain/attendance /app/src/domain/attendance

ARG RUNTIME_VERSION=unbuilt
ARG BUILD_SHA=unbuilt
ARG ATTENDANCE_RUNTIME_CAPABILITY=SHADOW_ONLY
ENV NODE_ENV=production \
    ATTENDANCE_RUNTIME_PORT=8088 \
    ATTENDANCE_RUNTIME_CAPABILITY=$ATTENDANCE_RUNTIME_CAPABILITY \
    RUNTIME_VERSION=$RUNTIME_VERSION \
    BUILD_SHA=$BUILD_SHA
RUN chown -R node:node /app
USER node
EXPOSE 8088
STOPSIGNAL SIGTERM
CMD ["node", "attendance-runtime/server.js"]
