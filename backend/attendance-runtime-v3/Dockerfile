FROM node:22.18-alpine AS runtime
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend/services/attendance/AttendanceEngineOrchestrator.js backend/services/attendance/WorkdayPersistenceContract.js backend/services/attendance/WorkdayPersistenceService.js ./services/attendance/
COPY backend/attendance-runtime-v3 ./attendance-runtime-v3/
COPY src/domain/attendance /app/src/domain/attendance
ARG RUNTIME_VERSION=attendance-runtime-v3
ARG BUILD_SHA=unbuilt
ARG ATTENDANCE_RUNTIME_CAPABILITY=ACTIVE_PERSIST_CAPABLE
ENV NODE_ENV=production ATTENDANCE_RUNTIME_PORT=8088 RUNTIME_VERSION=$RUNTIME_VERSION BUILD_SHA=$BUILD_SHA ATTENDANCE_RUNTIME_CAPABILITY=$ATTENDANCE_RUNTIME_CAPABILITY
RUN chown -R node:node /app
USER node
EXPOSE 8088
CMD ["node", "attendance-runtime-v3/server.js"]
