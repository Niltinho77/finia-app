import express, { Router } from "express";
import type { Request, Response } from "express";
import { interpretarMensagem } from "../services/iaService.js";
import { processarComando } from "../services/finiaCore.js";

export const iaRouter = Router();

/**
 * 🔍 Teste rápido da IA sem precisar do WhatsApp
 * Exemplo: POST /api/ia/analisar { "mensagem": "Gastei 50 reais no mercado" }
 */
iaRouter.post("/analisar", async (req: Request, res: Response) => {
  try {
    const { mensagem, telefone } = req.body;
    if (!mensagem) {
      return res.status(400).json({ error: "Campo 'mensagem' é obrigatório." });
    }

    console.log("🧠 IA - Recebendo mensagem de teste:", mensagem);

    // 1️⃣ Interpreta via OpenAI
    const comando = await interpretarMensagem(mensagem);
    console.log("🧩 Comando interpretado:", comando);

    // 2️⃣ Processa (simula como se viesse do WhatsApp)
    const resposta = await processarComando(comando, telefone || "+5551999999999");
    console.log("💬 Resposta gerada:", resposta);

    // 3️⃣ Retorna tudo pro front
    return res.json({
      mensagem_original: mensagem,
      comando_interpretado: comando,
      resposta_final: resposta,
    });
  } catch (err: any) {
    console.error("❌ Erro em /api/ia/analisar:", err);
    res.status(500).json({ error: "Erro interno ao processar mensagem." });
  }
});

export default iaRouter;
