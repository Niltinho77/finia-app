// src/server.ts
import express from "express";
import dotenv from "dotenv";
import whatsappRouter from "./routes/whatsapp.js";
import iaRouter from "./routes/ia.js";
import indexRouter from "./routes/index.js";

dotenv.config();

const app = express();
app.use(express.json());

app.use("/api", indexRouter);
app.use("/api/ia", iaRouter);
app.use("/whatsapp", whatsappRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ FinIA rodando em http://localhost:${PORT}`);
});
