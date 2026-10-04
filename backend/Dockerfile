# ──────────────────────────────────────────────────────────────
#  SIGNUM-CLOCK · Receptor ISUP 5.0
#  Docker image basada en Node Alpine para mínimo footprint
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine

# Metadatos
LABEL maintainer="Signum-Clock" \
      description="Receptor ISUP 5.0 Hikvision → Supabase"

# Directorio de trabajo
WORKDIR /app

# Copiar manifesto primero para aprovechar caching de capas
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm ci --omit=dev

# Copiar el código fuente
COPY server.js .

# Puerto TCP de escucha ISUP
EXPOSE 7660

# Variables de entorno requeridas (se inyectan en docker run / compose)
ENV NODE_ENV=production \
    ISUP_PORT=7660

# Punto de entrada
CMD ["node", "server.js"]
