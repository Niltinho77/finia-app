import OpenAI from "openai";
import dotenv from "dotenv";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { extrairDataEHora } from "../utils/dateExtractor.js";

dayjs.extend(customParseFormat);

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `Você é Lume, uma assistente financeira inteligente que ajuda usuários a controlar suas finanças pessoais via WhatsApp.

Analise a mensagem do usuário e retorne APENAS um JSON válido (sem crases, sem markdown) no formato:

{
  "tipo": "transacao" | "tarefa" | "outro",
  "acao": "inserir" | "editar" | "consultar" | "remover" | null,
  "descricao": "string" | null,
  "valor": number | null,
  "data": "YYYY-MM-DD" | null,
  "hora": "HH:mm" | null,
  "tipoTransacao": "ENTRADA" | "SAIDA" | null,
  "categoria": "string" | null,
  "periodo": "hoje" | "ontem" | "semana" | "mes" | null
}

REGRAS PARA "tipo":

- "transacao": mensagem envolve dinheiro, gasto, compra, pagamento, receita, salário, transferência
- "tarefa": mensagem envolve criar lembrete, agendar algo, marcar reunião, to-do
- "outro": QUALQUER OUTRO CASO, incluindo:
  - Saudações: "oi", "olá", "bom dia", "tudo bem", "boa tarde", "boa noite"
  - Perguntas sobre o app: "o que você faz?", "quais comandos?", "como funciona?"
  - Confirmações isoladas: "sim", "não", "ok", "obrigado", "entendi", "certo"
  - Textos sem contexto financeiro ou de tarefa

REGRAS PARA TRANSAÇÕES:
- Gasto/compra/pagamento/débito → tipoTransacao="SAIDA"
- Recebimento/salário/venda/depósito/crédito → tipoTransacao="ENTRADA"
- RESUMO/EXTRATO/CONSULTA → acao="consultar"
- Detecte período nas consultas:
  - "hoje", "diário", "do dia" → periodo="hoje"
  - "ontem" → periodo="ontem"
  - "semana", "desta semana", "semana passada" → periodo="semana"
  - "mês", "deste mês", "mês passado", "mensal", "mensais" → periodo="mes"
  - Consultas genéricas SEM período explícito ("meus gastos", "histórico", "extrato", "quanto gastei", "minhas despesas") → periodo="mes"
- Se houver data explícita ("18/12", "18 de dezembro"), preencha "data" em vez de "periodo"

REGRAS PARA TAREFAS:
- Ignore tipoTransacao, categoria e periodo (retorne null nesses campos)
- Extraia data e hora se mencionadas

REGRAS GERAIS:
- Nunca retorne "null" como string — use null literal
- Se tipo="outro", retorne acao=null, valor=null, tipoTransacao=null, categoria=null, periodo=null
- Categorize transações quando possível (alimentação, transporte, saúde, lazer, moradia, etc.)
- Use o histórico de conversa para entender referências como "aquele gasto", "a tarefa de ontem"`;

type HistoricoItem = {
  entrada: string;
  saida: string;
};

/** Interpreta mensagem do usuário com contexto de conversa opcional */
export async function interpretarMensagem(
  mensagem: string,
  historico?: HistoricoItem[]
): Promise<any | null> {
  console.log("🧠 interpretando mensagem:", mensagem);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Adiciona histórico de conversa como contexto (últimas interações)
  // Mantém o JSON bruto como conteúdo do assistente para que o GPT continue
  // respondendo no mesmo formato — nunca usar texto livre aqui.
  if (historico && historico.length > 0) {
    for (const item of historico) {
      messages.push({ role: "user", content: item.entrada });
      messages.push({ role: "assistant", content: item.saida });
    }
  }

  messages.push({ role: "user", content: mensagem });

  try {
    const resposta = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.2,
    });

    let texto = resposta.choices[0]?.message?.content?.trim() || "";
    if (!texto) return null;

    // Remove blocos markdown se vierem
    texto = texto
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    const json = JSON.parse(texto);

    // Saneamento: nunca "hora":"null" ou "data":"null"
    if (json.hora === "null") json.hora = null;
    if (json.data === "null") json.data = null;

    // Pós-processamento: complementar data/hora para inserções usando o parser unificado
    if (json.acao === "inserir") {
      const { data: dataObj, hora } = extrairDataEHora(mensagem);
      const dataParsed = dataObj ? dayjs(dataObj).format("YYYY-MM-DD") : null;

      if (json.tipo === "tarefa") {
        if (!json.data && dataParsed) json.data = dataParsed;
        if (!json.hora && hora) json.hora = hora;
      } else if (json.tipo === "transacao") {
        if (!json.data && dataParsed) json.data = dataParsed;
      }
    }

    console.log("✅ JSON interpretado:", json);
    return json;
  } catch (err: any) {
    console.error("❌ Erro ao interpretar IA:", err?.message);
    return null; // Retorna null — o chamador decide o que fazer
  }
}
