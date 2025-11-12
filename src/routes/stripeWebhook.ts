import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../db/client.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function stripeWebhookHandler(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Faltando assinatura");

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      (req as any).rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("✅ Evento recebido:", event.type);
  res.status(200).json({ received: true });
}
