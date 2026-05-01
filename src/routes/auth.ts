// src/routes/auth.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import dayjs from "dayjs";
import prisma from "../db/client.js";
import { authMiddleware } from "../middlewares/auth.js";
import { sendTextWithTemplateFallback } from "../services/whatsappService.js";

const router = Router();

const RESPOSTA_GENERICA_LOGIN = {
  message:
    "Se o telefone estiver cadastrado, você receberá um link de acesso pelo WhatsApp em alguns segundos.",
};

/**
 * POST /api/auth/login
 * Body: { "telefone": "+5551999999999" }
 *
 * Em vez de logar direto (inseguro — qualquer um que soubesse um telefone
 * cadastrado entrava na conta), agora apenas envia um magic link de 15 min
 * pelo WhatsApp. A resposta é genérica e nunca revela se o telefone existe.
 */
router.post("/login", async (req, res) => {
  const { telefone } = req.body as { telefone?: string };

  // Aceita apenas E.164 simples: + seguido de 10–15 dígitos
  if (!telefone || !/^\+\d{10,15}$/.test(telefone)) {
    return res
      .status(400)
      .json({ message: "Telefone inválido. Use o formato +5551999999999." });
  }

  // Resposta genérica é enviada SEMPRE — não revela se a conta existe.
  // O envio do link acontece em background.
  res.json(RESPOSTA_GENERICA_LOGIN);

  try {
    const usuario = await prisma.usuario.findUnique({ where: { telefone } });
    if (!usuario) return;

    const token = randomBytes(32).toString("hex");
    const expiraEm = dayjs().add(15, "minute").toDate();

    await prisma.dashboardMagicLink.create({
      data: { usuarioId: usuario.id, token, expiraEm },
    });

    const baseUrl = (
      process.env.DASHBOARD_URL ||
      process.env.FRONTEND_URL ||
      ""
    ).replace(/\/+$/, "");

    if (!baseUrl) {
      console.error("⚠️ /login: DASHBOARD_URL e FRONTEND_URL ausentes — magic link não enviado");
      return;
    }

    const link = `${baseUrl}/login?token=${encodeURIComponent(token)}`;

    await sendTextWithTemplateFallback(
      telefone,
      `🔗 *Acesso ao painel da FinIA*\n\nClique para entrar:\n${link}\n\n⚠️ Este link expira em 15 minutos e só pode ser usado uma vez.`
    );
  } catch (err) {
    console.error("Erro em /auth/login (envio de magic link):", err);
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
    return res
      .status(400)
      .json({ message: "Token do link mágico é obrigatório." });
  }

  try {
    const link = await prisma.dashboardMagicLink.findUnique({
      where: { token },
    });

    if (!link) {
      return res
        .status(400)
        .json({ message: "Link mágico inválido ou já utilizado." });
    }

    const agora = new Date();

    if (link.usado) {
      return res
        .status(400)
        .json({ message: "Este link mágico já foi utilizado." });
    }

    if (link.expiraEm <= agora) {
      return res
        .status(400)
        .json({
          message:
            "Este link mágico expirou. Peça um novo resumo pelo FinIA.",
        });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: link.usuarioId },
    });

    if (!usuario) {
      return res
        .status(404)
        .json({ message: "Usuário associado ao link não foi encontrado." });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET não configurado");
      return res
        .status(500)
        .json({ message: "Configuração interna ausente (JWT_SECRET)." });
    }

    await prisma.dashboardMagicLink.update({
      where: { id: link.id },
      data: { usado: true },
    });

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
    return res
      .status(500)
      .json({ message: "Erro interno ao validar o link mágico." });
  }
});

/**
 * GET /api/auth/me
 * Retorna o usuário autenticado atual.
 * Protegido por authMiddleware — exige Bearer token válido.
 */
router.get("/me", authMiddleware, async (req, res) => {
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