import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import stripeRoutes from "./routes/stripe.js";
import stripeSessionRoutes from "./routes/stripeSession.js";
import whatsappRoutes from "./routes/whatsapp.js";
import iaRoutes from "./routes/ia.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ✅ 1. CORS sempre antes de tudo
app.use(cors());

// ✅ 2. Rota exclusiva do Stripe (usa raw body)
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req: any, _res, next) => {
    req.rawBody = req.body;
    next();
  },
  stripeWebhookHandler
);

// ✅ 3. Parser JSON vem *depois* (não afeta o webhook)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ 4. Suas rotas normais
app.use("/api/stripe", stripeSessionRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/ia", iaRoutes);

app.get("/", (_req, res) => res.send("FinIA backend rodando 🚀"));

// ✅ 5. Subir o servidor
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ FinIA rodando em http://0.0.0.0:${PORT}`)
);
