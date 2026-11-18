FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production DB_PATH=/data/config.db PORT=4000
VOLUME ["/data"]
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
