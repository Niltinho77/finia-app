import { Router } from "express";
import Stripe from "stripe";
import prisma from "../db/client.js";

const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-10-29.clover",
});

// FRONTEND_URL ex: https://finia-dashboard.onrender.com
const FRONTEND_URL = process.env.FRONTEND_URL!;

// URLs de retorno do checkout
const successUrl = `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`;
const cancelUrl = `${FRONTEND_URL}/cancel`;

// ✅ GET (link simples) para criar sessão de checkout e redirecionar
router.get("/checkout", async (req, res) => {
  try {
    const userId = String(req.query.userId || "");
    if (!userId) {
      return res.status(400).json({ error: "userId obrigatório" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: userId } });
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // cria ou reaproveita o customer
    const customerId = usuario.stripeCustomerId
      ? usuario.stripeCustomerId
      : (await stripe.customers.create({ metadata: { userId } })).id;

    if (!usuario.stripeCustomerId) {
      await prisma.usuario.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // GET /checkout
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: usuario.id.toString(),
      },
    });

    return res.redirect(303, session.url!);
  } catch (e: any) {
    console.error("Erro checkout (GET):", e);
    return res.status(500).json({ error: "Falha ao criar sessão de checkout" });
  }
});

// ✅ POST (uso programático, se um dia usar no app/mobile)
router.post("/checkout", async (req, res) => {
  try {
    const { userId } = req.body as { userId: string };
    if (!userId) {
      return res.status(400).json({ error: "userId obrigatório" });
    }

    const usuario = await prisma.usuario.findUnique({ where: { id: userId } });
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const customerId = usuario.stripeCustomerId
      ? usuario.stripeCustomerId
      : (await stripe.customers.create({ metadata: { userId } })).id;

    if (!usuario.stripeCustomerId) {
      await prisma.usuario.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId },
  });

    return res.json({ url: session.url });
  } catch (e: any) {
    console.error("Erro checkout (POST):", e);
    return res.status(500).json({ error: "Falha ao criar sessão" });
  }
});

export default router;