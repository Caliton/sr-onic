#!/bin/bash
# ============================================================
# 🤖 SrOnic — Setup Script (WSL2 / Ubuntu 24.04)
# ============================================================
set -e

echo "🚀 Iniciando setup do SrOnic..."
echo "   Sistema: $(lsb_release -ds 2>/dev/null || echo 'Linux')"
echo "   RAM: $(free -h | awk '/^Mem:/{print $2}')"
echo ""

# ---------- 1. Node.js 20 LTS ----------
if command -v node &>/dev/null; then
    echo "✅ Node.js já instalado: $(node -v)"
else
    echo "📦 Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "✅ Node.js instalado: $(node -v)"
fi

# ---------- 2. ffmpeg (áudio) ----------
if command -v ffmpeg &>/dev/null; then
    echo "✅ ffmpeg já instalado: $(ffmpeg -version | head -1)"
else
    echo "📦 Instalando ffmpeg..."
    sudo apt-get update -qq
    sudo apt-get install -y ffmpeg
    echo "✅ ffmpeg instalado"
fi

# ---------- 3. Chromium deps (Puppeteer/Duda) ----------
echo "📦 Instalando dependências do Chromium (pra Duda gerar PDFs)..."
sudo apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 \
    libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2t64 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    ca-certificates 2>/dev/null || \
sudo apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    ca-certificates
echo "✅ Dependências do Chromium instaladas"

# ---------- 4. PM2 (process manager) ----------
if command -v pm2 &>/dev/null; then
    echo "✅ PM2 já instalado: $(pm2 -v)"
else
    echo "📦 Instalando PM2..."
    sudo npm install -g pm2
    echo "✅ PM2 instalado"
fi

# ---------- 5. Instalar dependências do projeto ----------
echo "📦 Instalando dependências do projeto (npm install)..."
npm install
echo "✅ Dependências instaladas"

# ---------- 6. Configurar .env ----------
if [ ! -f .env ]; then
    echo "📝 Criando .env a partir do .env.example..."
    cp .env.example .env
    echo ""
    echo "⚠️  ATENÇÃO: Edite o arquivo .env com suas API keys:"
    echo "   nano .env"
    echo ""
    echo "   Chaves necessárias:"
    echo "   - TELEGRAM_BOT_TOKEN (obrigatório)"
    echo "   - TELEGRAM_ALLOWED_USER_IDS (obrigatório)"
    echo "   - GEMINI_API_KEY ou DEEPSEEK_API_KEY (pelo menos 1)"
    echo "   - TAVILY_API_KEY (opcional, para busca web)"
    echo ""
else
    echo "✅ .env já existe"
fi

# ---------- 7. Build ----------
echo "🔨 Compilando TypeScript..."
npm run build
echo "✅ Build concluído"

# ---------- Resumo ----------
echo ""
echo "============================================================"
echo "🤖 SrOnic — Setup completo!"
echo "============================================================"
echo ""
echo "📋 Próximos passos:"
echo ""
echo "   1. Edite o .env com suas API keys:"
echo "      nano .env"
echo ""
echo "   2. Para rodar em desenvolvimento:"
echo "      npm run dev"
echo ""
echo "   3. Para rodar em produção (com PM2):"
echo "      pm2 start dist/index.js --name sronic"
echo "      pm2 save"
echo ""
echo "   4. Para ver logs em tempo real:"
echo "      pm2 logs sronic"
echo ""
echo "   5. Para parar:"
echo "      pm2 stop sronic"
echo ""
echo "============================================================"
echo "   RAM disponível: $(free -h | awk '/^Mem:/{print $7}') livres"
echo "   Node: $(node -v) | npm: $(npm -v) | PM2: $(pm2 -v 2>/dev/null || echo 'instalado')"
echo "============================================================"
