import express, { Router } from "express";
import type { Request, Response } from "express";
import prisma from "../db/client";
import { interpretarMensagem } from "../services/iaService.js";
import { processarComando } from "../services/finiaCore.js";
import { sendTextWithTemplateFallback } from "../services/whatsappService.js";
import { baixarMidiaWhatsApp, transcreverAudio } from "../utils/whatsappMedia.js";

export const whatsappRouter = Router();

/**
 * ✅ GET /whatsapp/webhook — verificação do Meta
 */
whatsappRouter.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WA_VERIFY_TOKEN) {
    console.log("✅ Webhook do WhatsApp verificado com sucesso!");
    return res.status(200).send(challenge);
  }

  console.warn("⚠️ Tentativa de verificação inválida:", { mode, token });
  return res.sendStatus(403);
});

/**
 * 💬 POST /whatsapp/webhook — recebe e processa mensagens (texto e áudio)
 */
whatsappRouter.post("/webhook", async (req: Request, res: Response) => {
  // 🚀 Meta exige resposta imediata
  res.sendStatus(200);

  try {
    const entries = req.body?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        const messages = change?.value?.messages ?? [];
        for (const msg of messages) {
          const normalized = mapMetaMessageToIncoming(msg);
          if (!normalized) continue;

          const numero = normalized.from;
          const messageId = msg.id;
          let texto = normalized.text || "";

          console.log(`📩 Nova mensagem (${normalized.type}) de ${numero}`);

          // ⚡ Evita processar duplicadas
          const jaExiste = await prisma.interacaoIA.findUnique({
            where: { messageId },
          });
          if (jaExiste) {
            console.log("⏩ Ignorando duplicada:", messageId);
            continue;
          }

          // 🎧 Caso seja áudio → baixa e transcreve
          if (normalized.type === "audio") {
          const audioId = msg.audio?.id;
          if (audioId) {
            console.log("🎙️ Recebido áudio. Iniciando download...");
            const caminho = await baixarMidiaWhatsApp(audioId);

            try {
              texto = await transcreverAudio(caminho);
            } catch (err: any) {
              console.error("❌ Erro ao processar áudio:", err);

              // 🔹 Se for áudio longo, responde direto e interrompe o fluxo
              if (err.message?.includes("10 segundos")) {
                await sendTextWithTemplateFallback(
                  normalized.from,
                  "⚠️ O áudio é muito longo! Envie mensagens de até 10 segundos."
                );
                console.log("📤 Aviso de áudio longo enviado ao usuário.");
                continue; // <---- interrompe o processamento dessa mensagem
              }

              // outros erros de áudio genéricos
              texto = "(erro ao transcrever áudio)";
            }
          }
}


          // 👤 Garante que o usuário exista
          const usuario = await prisma.usuario.upsert({
            where: { telefone: numero },
            update: {},
            create: { telefone: numero },
          });

          // 🧠 Interpreta via IA (texto ou transcrição)
          const comando = await interpretarMensagem(texto);

          // ⚙️ Processa comando no núcleo FinIA
          const resposta = await processarComando(
            { ...comando, textoOriginal: texto },
            numero
          );

          // 💾 Registra interação
          await prisma.interacaoIA.create({
            data: {
              usuarioId: usuario.id,
              entradaTexto: texto,
              respostaIA: JSON.stringify(comando),
              tipo: comando?.tipo?.toUpperCase?.() || "DESCONHECIDO",
              messageId,
            },
          });

          // 💬 Envia resposta
          try {
            await sendTextWithTemplateFallback(numero, resposta);
            console.log("📤 Resposta enviada com sucesso!");
          } catch (sendErr: any) {
            console.error(
              "❌ Erro ao enviar resposta:",
              sendErr?.response?.data || sendErr
            );
          }
        }
      }
    }
  } catch (err: any) {
    console.error("🚨 Erro no webhook WhatsApp:", err?.response?.data || err);
  }
});

/** ===== Helper para normalizar mensagens ===== */
type IncomingMetaMessage = {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  audio?: { id?: string; mime_type?: string };
};

function mapMetaMessageToIncoming(msg: IncomingMetaMessage) {
  let from = `+${msg.from}`.replace(/\s+/g, "");

  // 🇧🇷 Corrige número brasileiro sem o 9
  const brRegex = /^\+55(\d{2})(\d{8})$/;
  if (brRegex.test(from)) {
    const [, ddd, rest] = from.match(brRegex)!;
    from = `+55${ddd}9${rest}`;
  }

  if (msg.type === "text" && msg.text?.body) {
    return { from, type: "text" as const, text: msg.text.body };
  }

  if (msg.type === "audio" && msg.audio?.id) {
    return {
      from,
      type: "audio" as const,
      audioUrl: msg.audio.id,
      text: undefined,
    };
  }

  return null;
}

export default whatsappRouter;
