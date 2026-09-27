# Judgely Self-Hostable Container
# Pinned runtime: Node.js 22 LTS Alpine
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy dependency manifests and install pinned dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code, seed fixtures, and configuration
COPY . .

# Create persistent database directory
RUN mkdir -p /app/data

# Pre-seed the SQLite database with fixtures.json so the container boots 100% offline
RUN node src/db/seeder.js

# Expose default port
EXPOSE 8080

# Healthcheck for container readiness
HEALTHCHECK --interval=20s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/projects || exit 1

CMD ["node", "src/server.js"]
