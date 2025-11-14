-- CreateTable
CREATE TABLE "DashboardMagicLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardMagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardMagicLink_token_key" ON "DashboardMagicLink"("token");

-- CreateIndex
CREATE INDEX "DashboardMagicLink_usuarioId_idx" ON "DashboardMagicLink"("usuarioId");

-- CreateIndex
CREATE INDEX "DashboardMagicLink_expiraEm_idx" ON "DashboardMagicLink"("expiraEm");

-- AddForeignKey
ALTER TABLE "DashboardMagicLink" ADD CONSTRAINT "DashboardMagicLink_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
