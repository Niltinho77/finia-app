// src/routes/transacoes.ts
import { Router } from "express";
import  prisma  from "../db/client.js";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

// aplica o middleware a todas as rotas deste módulo
router.use(authMiddleware);

/**
 * Converte o tipo usado no front-end ("INCOME"/"EXPENSE")
 * para o enum do Prisma ("ENTRADA"/"SAIDA") e vice-versa.
 */
function toPrismaTipo(tipo: string): "ENTRADA" | "SAIDA" {
  return tipo === "INCOME" ? "ENTRADA" : "SAIDA";
}
function fromPrismaTipo(tipo: "ENTRADA" | "SAIDA"): "INCOME" | "EXPENSE" {
  return tipo === "ENTRADA" ? "INCOME" : "EXPENSE";
}

/**
 * GET /api/transactions
 * Aceita filtros via query: from, to (datas ISO), type ("INCOME"/"EXPENSE"), category (nome da categoria)
 */
router.get("/", async (req, res) => {
  const userId = (req as any).userId as string;
  const { from, to, type, category } = req.query;

  const where: any = {
    usuarioId: userId,
  };

  // filtro por tipo
  if (typeof type === "string" && type !== "ALL") {
    where.tipo = toPrismaTipo(type);
  }

  // filtro por intervalo de datas
  if (typeof from === "string" && typeof to === "string") {
    where.data = {
      gte: new Date(from),
      lte: new Date(to),
    };
  }

  // filtro por nome de categoria (opcional)
  if (typeof category === "string") {
    // procura a categoria pelo nome e tipo do filtro (se existir)
    const categoria = await prisma.categoria.findFirst({
      where: { nome: category },
    });
    if (categoria) {
      where.categoriaId = categoria.id;
    } else {
      // se não existe tal categoria, devolve lista vazia
      return res.json([]);
    }
  }

  const transacoes = await prisma.transacao.findMany({
    where,
    include: {
      categoria: true,
    },
    orderBy: { data: "desc" },
  });

  // converte enums e nomes pro front-end
  const result = transacoes.map((t) => ({
    id: t.id,
    description: t.descricao,
    amount: t.valor,
    type: fromPrismaTipo(t.tipo),
    category: t.categoria?.nome ?? "Outros",
    date: t.data.toISOString(),
    confirmado: t.confirmado,
    createdAt: t.criadoEm,
    updatedAt: t.atualizadoEm,
  }));

  res.json(result);
});

/**
 * POST /api/transactions
 * Corpo esperado: { description, amount, type ("INCOME"/"EXPENSE"), category, date }
 */
router.post("/", async (req, res) => {
  const userId = (req as any).userId as string;
  const { description, amount, type, category, date } = req.body;

  if (!description || typeof amount !== "number" || !type) {
    return res.status(400).json({ message: "Dados inválidos." });
  }

  // obtém ou cria a categoria se fornecida
  let categoriaId: string | undefined;
  if (category) {
    const categoriaTipo = toPrismaTipo(type);
    let cat = await prisma.categoria.findFirst({
      where: { nome: category, tipo: categoriaTipo },
    });
    if (!cat) {
      cat = await prisma.categoria.create({
        data: { nome: category, tipo: categoriaTipo },
      });
    }
    categoriaId = cat.id;
  }

  const nova = await prisma.transacao.create({
    data: {
      usuarioId: userId,
      descricao: description,
      valor: amount,
      tipo: toPrismaTipo(type),
      data: date ? new Date(date) : new Date(),
      categoriaId,
      confirmado: true,
    },
    include: { categoria: true },
  });

  res.status(201).json({
    id: nova.id,
    description: nova.descricao,
    amount: nova.valor,
    type,
    category: nova.categoria?.nome ?? "Outros",
    date: nova.data.toISOString(),
  });
});

/**
 * PUT /api/transactions/:id
 * Atualiza uma transação existente (mesmos campos do POST).
 */
router.put("/:id", async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const { description, amount, type, category, date } = req.body;

  const transacao = await prisma.transacao.findUnique({
    where: { id },
  });
  if (!transacao || transacao.usuarioId !== userId) {
    return res.status(404).json({ message: "Transação não encontrada." });
  }

let categoriaId: string | undefined = transacao.categoriaId ?? undefined;
  if (category) {
    const categoriaTipo = toPrismaTipo(type || fromPrismaTipo(transacao.tipo));
    let cat = await prisma.categoria.findFirst({
      where: { nome: category, tipo: categoriaTipo },
    });
    if (!cat) {
      cat = await prisma.categoria.create({
        data: { nome: category, tipo: categoriaTipo },
      });
    }
    categoriaId = cat.id;
  }

  const atualizada = await prisma.transacao.update({
    where: { id },
    data: {
      descricao: description ?? transacao.descricao,
      valor: typeof amount === "number" ? amount : transacao.valor,
      tipo: type ? toPrismaTipo(type) : transacao.tipo,
      data: date ? new Date(date) : transacao.data,
      categoriaId,
    },
    include: { categoria: true },
  });

  res.json({
    id: atualizada.id,
    description: atualizada.descricao,
    amount: atualizada.valor,
    type: fromPrismaTipo(atualizada.tipo),
    category: atualizada.categoria?.nome ?? "Outros",
    date: atualizada.data.toISOString(),
  });
});

/**
 * DELETE /api/transactions/:id
 * Remove uma transação do usuário.
 */
router.delete("/:id", async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  const transacao = await prisma.transacao.findUnique({ where: { id } });
  if (!transacao || transacao.usuarioId !== userId) {
    return res.status(404).json({ message: "Transação não encontrada." });
  }

  await prisma.transacao.delete({ where: { id } });
  res.json({ success: true });
});

export default router;
