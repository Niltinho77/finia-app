# ======================
# Etapa 1: Build (compila o TypeScript e gera Prisma Client)
# ======================
FROM node:20-alpine AS builder
WORKDIR /app

# Copia pacotes e instala dependências
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm
RUN pnpm install

# Copia o restante do projeto
COPY package*.json ./
RUN pnpm install
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
RUN pnpm build

# Gera Prisma Client antes de compilar
RUN pnpm prisma generate

# Compila o projeto TypeScript
RUN pnpm build

# ======================
# Etapa 2: Run (produção)
# ======================
FROM node:20-alpine AS runner
WORKDIR /app

# Copia apenas os artefatos necessários do build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/.env ./.env

# Porta padrão usada pela Railway
ENV PORT=3000
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "dist/server.js"]
