# Multi-stage build for production optimization
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# ====================================
# Dependencies stage (production only)
# ====================================
FROM base AS deps

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# ====================================
# Build dependencies stage (includes devDependencies)
# ====================================
FROM base AS build-deps

# Install ALL dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci && \
    npm cache clean --force

# ====================================
# Development stage
# ====================================
FROM base AS development

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies)
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3010

# Run development server
CMD ["npm", "run", "dev"]

# ====================================
# Builder stage (for production)
# ====================================
FROM base AS builder

# Copy dependencies from build-deps stage (includes devDependencies)
COPY --from=build-deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create public folder if it doesn't exist (Next.js optional)
RUN mkdir -p public

# Set build-time environment variables
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production

# Build the application
RUN npm run build

# ====================================
# Production stage
# ====================================
FROM base AS production

# Set production environment
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3010

# Set port environment variable
ENV PORT 3010
ENV HOSTNAME "0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3010/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "server.js"]
