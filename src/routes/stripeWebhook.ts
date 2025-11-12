import { Request, Response } from "express";
import Stripe from "stripe";
import prisma from "../db/client.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-10-29.clover",
});

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
    console.error("❌ Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // 🔹 Pagamento inicial concluído
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (!userId) {
          console.warn("⚠️ checkout.session.completed sem metadata.userId");
          break;
        }

        const premiumExpiraEm = new Date();
        premiumExpiraEm.setMonth(premiumExpiraEm.getMonth() + 1); // 1 mês de premium

        await prisma.usuario.update({
          where: { id: userId },
          data: {
            plano: "PREMIUM",
            stripeCustomerId: customerId ?? null,
            stripeSubscriptionId: subscriptionId ?? null,
            premiumExpiraEm,
          },
        });

        console.log(`✅ Usuário ${userId} atualizado para PREMIUM`);
        break;
      }

      // 🔹 Assinatura criada (normalmente disparado junto ao checkout.session)
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`ℹ️ Assinatura criada: ${sub.id}`);
        break;
      }

      // 🔹 Pagamento de renovação bem-sucedido
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const userId = invoice.metadata?.userId;

        if (userId) {
          const premiumExpiraEm = new Date();
          premiumExpiraEm.setMonth(premiumExpiraEm.getMonth() + 1);

          await prisma.usuario.update({
            where: { id: userId },
            data: {
              plano: "PREMIUM",
              premiumExpiraEm,
            },
          });

          console.log(`💰 Renovação bem-sucedida — usuário ${userId} continua PREMIUM`);
        } else {
          console.log("ℹ️ invoice.payment_succeeded sem userId (ignorado)");
        }
        break;
      }

      // 🔹 Pagamento falhou (cartão expirado, etc.)
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const userId = invoice.metadata?.userId;
        console.warn(`⚠️ Pagamento falhou para usuário ${userId ?? "desconhecido"}`);
        break;
      }

      // 🔹 Assinatura cancelada (manual ou automática)
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata as any)?.userId;

        if (userId) {
          await prisma.usuario.update({
            where: { id: userId },
            data: {
              plano: "TRIAL",
              premiumExpiraEm: null,
              stripeSubscriptionId: null,
            },
          });

          console.log(`⚠️ Assinatura cancelada — usuário ${userId} rebaixado para TRIAL`);
        } else {
          console.warn("⚠️ Assinatura cancelada sem userId (ignorado)");
        }
        break;
      }

      // 🔹 Outros eventos (só para log)
      default:
        console.log(`ℹ️ Evento ignorado: ${event.type}`);
    }
  } catch (err) {
    console.error("❌ Erro ao processar evento:", err);
  }

  res.status(200).json({ received: true });
}
