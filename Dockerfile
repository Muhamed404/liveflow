# One image: the backend serves the API and the built dashboard.
#   docker build -t liveflow .
#   docker run -p 4000:4000 -v liveflow-data:/data -e ENCRYPTION_KEY=... -e ADMIN_PASSWORD=... liveflow

# ---- 1. build the frontend ----
FROM node:20.18-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. backend production deps (better-sqlite3 ships prebuilt binaries for glibc) ----
FROM node:20.18-slim AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ---- 3. runtime ----
FROM node:20.18-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/data/config.db \
    STATIC_DIR=/app/public \
    CORS_ORIGIN=same-origin \
    AUTH_MODE=local
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/scripts/create-user.js ./scripts/create-user.js
COPY --from=web /web/dist ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
