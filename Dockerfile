# ======================
# Etapa 1: Build
# ======================
FROM node:20-alpine AS builder
WORKDIR /app

# Copia dependências
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm
RUN pnpm install

# Copia o restante do código
COPY . .


# ======================
# Etapa 2: Execução
# ======================
FROM node:20-alpine
WORKDIR /app

# Copia apenas o necessário do builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm
RUN pnpm install --prod

# Prisma generate
RUN pnpm prisma generate

# Gera build TypeScript
RUN pnpm build

EXPOSE 3000
CMD ["node", "dist/server.js"]
