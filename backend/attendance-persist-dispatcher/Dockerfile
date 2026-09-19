FROM node:22.18-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend/attendance-persist-dispatcher ./attendance-persist-dispatcher/
USER node
CMD ["node", "attendance-persist-dispatcher/server.js"]
