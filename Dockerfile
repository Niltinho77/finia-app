# Etapa 1 - Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copia apenas os arquivos essenciais
COPY package*.json ./
RUN npm install -g pnpm
RUN pnpm install

# Copia o restante do código
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./

# Gera o Prisma Client e compila TypeScript
RUN pnpm prisma generate
RUN pnpm build

# Etapa 2 - Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Copia arquivos necessários da build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

# Railway já injeta as variáveis de ambiente automaticamente
EXPOSE 3000
CMD ["node", "dist/server.js"]
