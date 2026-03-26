# ============================================================
# 🤖 SrOnic — Dockerfile (Multi-stage build)
# ============================================================

# ---------- Stage 1: Build ----------
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


# ---------- Stage 2: Production ----------
FROM node:20-slim AS production

# Labels
LABEL maintainer="ONIC_TECH"
LABEL description="SrOnic - Agente pessoal de IA via Telegram"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # ffmpeg (áudio/Whisper)
    ffmpeg \
    # Chromium deps (Puppeteer/Duda)
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    # Fontes (pra PDFs bonitos da Duda)
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    # Certificados SSL
    ca-certificates \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r sronic && useradd -r -g sronic -m sronic

WORKDIR /app

# Copy package files and install production deps (with native compilation)
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Download Puppeteer's Chromium (before switching user, but cache to sronic's home)
# We set PUPPETEER_CACHE_DIR so Chrome is accessible to the sronic user at runtime
ENV PUPPETEER_CACHE_DIR=/home/sronic/.cache/puppeteer
RUN npx puppeteer browsers install chrome \
    && chown -R sronic:sronic /home/sronic/.cache

# Copy built JS from builder stage
COPY --from=builder /app/dist/ ./dist/

# Copy runtime files
COPY .agents/ ./.agents/
COPY .env.example ./.env.example

# Create persistent directories
RUN mkdir -p data tmp data/activities logs \
    && chown -R sronic:sronic /app

# Switch to non-root user
USER sronic

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Start
CMD ["node", "dist/index.js"]
