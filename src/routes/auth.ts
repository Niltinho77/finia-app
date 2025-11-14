// src/routes/auth.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import prisma from "../db/client.js";

const router = Router();

/**
 * POST /api/auth/login
 * Exemplo de corpo: { "telefone": "+5551999999999" }
 * Login tradicional por telefone (sem link mágico).
 */
router.post("/login", async (req, res) => {
  const { telefone } = req.body as { telefone?: string };

  if (!telefone) {
    return res.status(400).json({ message: "Telefone é obrigatório." });
  }

  try {
    // procura usuário pelo telefone
    const usuario = await prisma.usuario.findUnique({ where: { telefone } });

    if (!usuario) {
      return res.status(401).json({ message: "Usuário não encontrado." });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET não configurado");
      return res
        .status(500)
        .json({ message: "Configuração interna ausente (JWT_SECRET)." });
    }

    // gera JWT válido por 7 dias
    const token = jwt.sign(
      { userId: usuario.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      user: {
        id: usuario.id,
        nome: usuario.nome,
        telefone: usuario.telefone,
        idioma: usuario.idioma,
        plano: usuario.plano,
        trialExpiraEm: usuario.trialExpiraEm,
        premiumExpiraEm: usuario.premiumExpiraEm,
        criadoEm: usuario.criadoEm,
      },
      token,
    });
  } catch (err) {
    console.error("Erro em /auth/login:", err);
    return res.status(500).json({ message: "Erro interno ao fazer login." });
  }
});

/**
 * POST /api/auth/magic-login
 * Fluxo de login via link mágico:
 * Body: { "token": "abc123..." }
 * - Valida token em DashboardMagicLink
 * - Verifica se não expirou e não foi usado
 * - Marca como usado
 * - Gera JWT normal e devolve user + token
 */
router.post("/magic-login", async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    return res.status(400).json({ message: "Token do link mágico é obrigatório." });
  }

  try {
    // procura o link mágico pelo token
    const link = await prisma.dashboardMagicLink.findUnique({
      where: { token },
    });

    if (!link) {
      return res.status(400).json({ message: "Link mágico inválido ou já utilizado." });
    }

    const agora = new Date();

    if (link.usado) {
      return res.status(400).json({ message: "Este link mágico já foi utilizado." });
    }

    if (link.expiraEm <= agora) {
      return res.status(400).json({ message: "Este link mágico expirou. Peça um novo resumo pelo FinIA." });
    }

    // carrega usuário
    const usuario = await prisma.usuario.findUnique({
      where: { id: link.usuarioId },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuário associado ao link não foi encontrado." });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET não configurado");
      return res
        .status(500)
        .json({ message: "Configuração interna ausente (JWT_SECRET)." });
    }

    // marca o link como usado, para não permitir reuso
    await prisma.dashboardMagicLink.update({
      where: { id: link.id },
      data: { usado: true },
    });

    // gera JWT normal de 7 dias
    const jwtToken = jwt.sign(
      { userId: usuario.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      user: {
        id: usuario.id,
        nome: usuario.nome,
        telefone: usuario.telefone,
        idioma: usuario.idioma,
        plano: usuario.plano,
        trialExpiraEm: usuario.trialExpiraEm,
        premiumExpiraEm: usuario.premiumExpiraEm,
        criadoEm: usuario.criadoEm,
      },
      token: jwtToken,
    });
  } catch (err) {
    console.error("Erro em /auth/magic-login:", err);
    return res.status(500).json({ message: "Erro interno ao validar o link mágico." });
  }
});

/**
 * GET /api/auth/me
 * Retorna o usuário autenticado atual.
 * Requer que o authMiddleware tenha preenchido req.userId.
 */
router.get("/me", async (req, res) => {
  const { userId } = req as any;
  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: userId },
      include: {
        transacoes: false,
        tarefas: false,
      },
    });

    if (!usuario) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    return res.json({
      id: usuario.id,
      nome: usuario.nome,
      telefone: usuario.telefone,
      idioma: usuario.idioma,
      plano: usuario.plano,
      trialExpiraEm: usuario.trialExpiraEm,
      premiumExpiraEm: usuario.premiumExpiraEm,
      criadoEm: usuario.criadoEm,
    });
  } catch (err) {
    console.error("Erro em /auth/me:", err);
    return res.status(500).json({ message: "Erro interno ao carregar usuário." });
  }
});

export default router;