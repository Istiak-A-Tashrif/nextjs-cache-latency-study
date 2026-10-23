FROM node:22.23.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js query.sql ./
CMD ["node","server.js"]
