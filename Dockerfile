# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY app/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Runtime stage
FROM node:18-alpine

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY app/server.js .
COPY app/openapi.json .
COPY app/config ./config
COPY app/controllers ./controllers
COPY app/middleware ./middleware
COPY app/models ./models
COPY app/routes ./routes
COPY app/services ./services
COPY app/utils ./utils
COPY app/constants ./constants
COPY app/public ./public

# Note: Environment variables should be passed at runtime using -e or --env-file
# Example: docker run -e CLIENT_ID=xxx -e CLIENT_SECRET=yyy ... or docker run --env-file .env ...

# Expose port (adjust if needed)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "server.js"]
