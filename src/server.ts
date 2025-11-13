import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import stripeRoutes from "./routes/stripe.js";
import stripeSessionRoutes from "./routes/stripeSession.js";
import whatsappRoutes from "./routes/whatsapp.js";
import iaRoutes from "./routes/ia.js";
import authRouter from "./routes/auth.js";
import transactionsRouter from "./routes/transacoes.js";
import tasksRouter from "./routes/tarefas.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;


// ✅ 1. Middleware de log pra debug temporário
app.use((req, _res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

// ✅ 2. Isolar o webhook — usa express.raw() SOMENTE nele
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req: any, _res, next) => {
    req.rawBody = req.body;
    next();
  },
  stripeWebhookHandler
);

// ✅ 3. As demais rotas usam JSON normalmente
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// monta as novas rotas
app.use("/api/auth", authRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/tasks", tasksRouter);

// ✅ 4. Suas rotas normais
app.use("/api/stripe", stripeSessionRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/whatsapp", whatsappRoutes);
app.use("/ia", iaRoutes);

app.get("/", (_req, res) => res.send("FinIA backend rodando 🚀"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ FinIA rodando em http://0.0.0.0:${PORT}`);
});

export default app;
