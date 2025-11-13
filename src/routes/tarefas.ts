// src/routes/tarefas.ts
import { Router } from "express";
import  prisma  from "../db/client.js";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

// aplica o middleware a todas as rotas deste módulo
router.use(authMiddleware);

/**
 * Converte o status entre enums do Prisma e do front-end.
 */
function toPrismaStatus(status: string): "PENDENTE" | "CONCLUIDA" | "CANCELADA" {
  switch (status) {
    case "DONE":
      return "CONCLUIDA";
    case "CANCELLED":
      return "CANCELADA";
    default:
      return "PENDENTE";
  }
}
function fromPrismaStatus(
  status: "PENDENTE" | "CONCLUIDA" | "CANCELADA"
): "PENDING" | "DONE" | "CANCELLED" {
  switch (status) {
    case "CONCLUIDA":
      return "DONE";
    case "CANCELADA":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

/**
 * GET /api/tasks
 * Lista todas as tarefas do usuário.
 * Aceita filtro opcional ?status=PENDING|DONE|CANCELLED
 */
router.get("/", async (req, res) => {
  const userId = (req as any).userId as string;
  const { status } = req.query;

  const where: any = { usuarioId: userId };
  if (typeof status === "string" && status !== "ALL") {
    where.status = toPrismaStatus(status);
  }

  const tarefas = await prisma.tarefa.findMany({
    where,
    orderBy: { criadoEm: "desc" },
  });

  const result = tarefas.map((t) => ({
    id: t.id,
    title: t.descricao,
    description: t.origemTexto ?? "",
    status: fromPrismaStatus(t.status),
    dueDate: t.data ? t.data.toISOString() : null,
    createdAt: t.criadoEm,
    updatedAt: t.atualizadoEm,
  }));

  res.json(result);
});

/**
 * POST /api/tasks
 * Cria uma nova tarefa.
 * Corpo esperado: { title, description?, dueDate? }
 */
router.post("/", async (req, res) => {
  const userId = (req as any).userId as string;
  const { title, description, dueDate } = req.body;

  if (!title) {
    return res.status(400).json({ message: "Título é obrigatório." });
  }

  const nova = await prisma.tarefa.create({
    data: {
      usuarioId: userId,
      descricao: title,
      origemTexto: description ?? null,
      data: dueDate ? new Date(dueDate) : null,
      status: "PENDENTE",
    },
  });

  res.status(201).json({
    id: nova.id,
    title: nova.descricao,
    description: nova.origemTexto ?? "",
    status: "PENDING",
    dueDate: nova.data ? nova.data.toISOString() : null,
  });
});

/**
 * PUT /api/tasks/:id
 * Atualiza uma tarefa existente.
 * Corpo pode conter { title?, description?, status?, dueDate? }
 */
router.put("/:id", async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const { title, description, status, dueDate } = req.body;

  const tarefa = await prisma.tarefa.findUnique({ where: { id } });
  if (!tarefa || tarefa.usuarioId !== userId) {
    return res.status(404).json({ message: "Tarefa não encontrada." });
  }

  const atualizada = await prisma.tarefa.update({
    where: { id },
    data: {
      descricao: title ?? tarefa.descricao,
      origemTexto:
        description !== undefined ? description : tarefa.origemTexto,
      status: status ? toPrismaStatus(status) : tarefa.status,
      data: dueDate ? new Date(dueDate) : tarefa.data,
    },
  });

  res.json({
    id: atualizada.id,
    title: atualizada.descricao,
    description: atualizada.origemTexto ?? "",
    status: fromPrismaStatus(atualizada.status),
    dueDate: atualizada.data ? atualizada.data.toISOString() : null,
  });
});

/**
 * DELETE /api/tasks/:id
 * Remove uma tarefa.
 */
router.delete("/:id", async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  const tarefa = await prisma.tarefa.findUnique({ where: { id } });
  if (!tarefa || tarefa.usuarioId !== userId) {
    return res.status(404).json({ message: "Tarefa não encontrada." });
  }

  await prisma.tarefa.delete({ where: { id } });
  res.json({ success: true });
});

export default router;
