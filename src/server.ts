import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { stripeWebhookHandler } from "./routes/stripeWebhook.js";
import stripeRoutes from "./routes/stripe.js";
import whatsappRoutes from "./routes/whatsapp.js";
import iaRoutes from "./routes/ia.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ CORS
app.use(cors());

// ✅ Webhook Stripe vem ANTES do express.json()
app.post(
  "/api/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req: any, _res, next) => {
    req.rawBody = req.body;
    next();
  },
  stripeWebhookHandler
);

// ✅ Depois disso vem o resto
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/api/stripe", stripeRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/ia", iaRoutes);

app.get("/", (_req, res) => res.send("FinIA backend rodando 🚀"));

app.listen(PORT, () => console.log(`Servidor FinIA rodando na porta ${PORT}`));
