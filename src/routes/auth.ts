// src/routes/auth.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import prisma from "../db/client.js";
import { authMiddleware } from "../middlewares/auth.js";

const router = Router();

function gerarJwt(usuarioId: string) {
  return jwt.sign(
    { userId: usuarioId },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );
}

/**
 * POST /api/auth/login
 * Login por telefone (hoje usado no dashboard).
 * Body: { "telefone": "+5551999999999" }
 */
router.post("/login", async (req, res) => {
  const { telefone } = req.body as { telefone?: string };

  if (!telefone) {
    return res.status(400).json({ message: "Telefone é obrigatório." });
  }

  const usuario = await prisma.usuario.findUnique({ where: { telefone } });
  if (!usuario) {
    return res.status(401).json({ message: "Usuário não encontrado." });
  }

  const token = gerarJwt(usuario.id);

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
});

/**
 * ✅ NOVO — POST /api/auth/login-magic
 * Valida um token de link mágico do dashboard e devolve JWT + dados do usuário.
 *
 * Body: { "token": "<token_longao_que_veio_na_url>" }
 */
router.post("/login-magic", async (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    return res.status(400).json({ message: "Token é obrigatório." });
  }

  const registro = await prisma.dashboardMagicLink.findUnique({
    where: { token },
  });

  const agora = new Date();

  if (!registro) {
    return res.status(401).json({ message: "Link inválido." });
  }

  if (registro.usado) {
    return res.status(401).json({ message: "Este link já foi utilizado." });
  }

  if (registro.expiraEm <= agora) {
    return res.status(401).json({ message: "Este link expirou. Peça um novo resumo para gerar outro link." });
  }

  // Carrega o usuário do link
  const usuario = await prisma.usuario.findUnique({
    where: { id: registro.usuarioId },
  });

  if (!usuario) {
    return res.status(404).json({ message: "Usuário do link não encontrado." });
  }

  // Marca o link como usado (one-time link)
  await prisma.dashboardMagicLink.update({
    where: { id: registro.id },
    data: {
      usado: true,
    },
  });

  // Gera JWT normal de sessão
  const jwtToken = gerarJwt(usuario.id);

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
});

/**
 * GET /api/auth/me
 * Retorna o usuário autenticado atual.
 * 🔒 Agora protegido com authMiddleware.
 */
router.get("/me", authMiddleware, async (req, res) => {
  const { userId } = req as any;
  if (!userId) {
    return res.status(401).json({ message: "Não autenticado." });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: userId },
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
});

export default router;