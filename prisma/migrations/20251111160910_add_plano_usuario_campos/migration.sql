/*
  Warnings:

  - The `plano` column on the `Usuario` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PlanoUsuario" AS ENUM ('TRIAL', 'PREMIUM', 'TESTER', 'BLOQUEADO');

-- AlterEnum
ALTER TYPE "TipoInteracaoIA" ADD VALUE 'OUTRO';

-- DropForeignKey
ALTER TABLE "InteracaoIA" DROP CONSTRAINT "InteracaoIA_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "Tarefa" DROP CONSTRAINT "Tarefa_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "Transacao" DROP CONSTRAINT "Transacao_usuarioId_fkey";

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "trialAtivadoEm" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "plano",
ADD COLUMN     "plano" "PlanoUsuario" DEFAULT 'TRIAL';

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteracaoIA" ADD CONSTRAINT "InteracaoIA_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
