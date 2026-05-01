import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export function validateMetaSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const appSecret = process.env.WA_APP_SECRET;

  if (!appSecret) {
    console.error(
      "🚨 WA_APP_SECRET não configurado — webhook do WhatsApp está aceitando requisições NÃO validadas. Configure imediatamente."
    );
    return res.status(500).send("Webhook misconfigured");
  }

  const header = req.headers["x-hub-signature-256"];
  if (typeof header !== "string" || !header.startsWith("sha256=")) {
    console.warn("⚠️ Webhook WhatsApp: header X-Hub-Signature-256 ausente ou inválido");
    return res.sendStatus(401);
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody || rawBody.length === 0) {
    console.warn("⚠️ Webhook WhatsApp: rawBody indisponível — verify callback não rodou");
    return res.sendStatus(400);
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const a = Buffer.from(header);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn("⚠️ Webhook WhatsApp: assinatura HMAC inválida — requisição rejeitada");
    return res.sendStatus(401);
  }

  return next();
}
