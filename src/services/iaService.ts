import OpenAI from "openai";
import dotenv from "dotenv";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** 🧭 Mapeamento dos dias da semana em português → número ISO (1 = segunda, 7 = domingo) */
const diasSemana: Record<string, number> = {
  segunda: 1,
  terca: 2,
  "terça": 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

/** 🧠 Extrai data e hora da mensagem antes da IA */
function extrairDataHora(texto: string) {
  const lower = texto.toLowerCase();
  let data = dayjs();
  let hora: string | null = null;

  // 1️⃣ Detecta expressões relativas
  if (lower.includes("amanh")) {
    data = data.add(1, "day");
  } else if (lower.includes("depois")) {
    data = data.add(2, "day");
  }

  // 2️⃣ Detecta menção a dia da semana (terça, sexta etc.)
  else {
    for (const [diaNome, diaNumero] of Object.entries(diasSemana)) {
      if (lower.includes(diaNome)) {
        const hoje = dayjs();
        const diaHoje = hoje.isoWeekday();
        let diff = diaNumero - diaHoje;
        if (diff <= 0) diff += 7; // sempre pega o próximo dia
        data = hoje.add(diff, "day");
        break;
      }
    }
  }

  // 3️⃣ Detecta formato de data explícita (10/11, 05-12, etc.)
  const matchData = lower.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (matchData) {
    const [_, dia, mes] = matchData;
    const anoAtual = dayjs().year();
    let parsed = dayjs(`${anoAtual}-${mes}-${dia}`, "YYYY-MM-DD");
    if (parsed.isBefore(dayjs(), "day")) parsed = parsed.add(1, "year");
    data = parsed;
  }

  // 4️⃣ Detecta hora (às 19h, 19hrs, 19:00 etc.)
  const h = lower.match(/(\d{1,2})(?:(?:h|:)(\d{0,2}))?/);
  if (h) {
    const hh = h[1].padStart(2, "0");
    const mm = h[2] ? h[2].padEnd(2, "0") : "00";
    hora = `${hh}:${mm}`;
  }

  return {
    data: data.format("YYYY-MM-DD"),
    hora,
  };
}

/** 🔥 Interpreta mensagem, mas já com data/hora resolvidas */
export async function interpretarMensagem(mensagem: string) {
  console.log("🧠 interpretando mensagem:", mensagem);

 const prompt = `
Você é Lume, uma assistente financeira inteligente. Analise a frase e retorne APENAS um JSON válido (sem crases) no formato:

{
  "tipo": "transacao" | "tarefa",
  "acao": "inserir" | "editar" | "consultar" | "remover",
  "descricao": "string",
  "valor": number | null,
  "data": "YYYY-MM-DD" | null,
  "hora": "HH:mm" | null,
  "tipoTransacao": "ENTRADA" | "SAIDA" | null,
  "categoria": "string" | null,
  "periodo": "hoje" | "ontem" | "semana" | "mes" | null
}

REGRAS:
- Se a frase indicar RESUMO/EXTRATO/CONSULTA (ex.: "gastos do mês", "quanto gastei esta semana", "resumo de hoje"): acao="consultar".
- Detecte o PERÍODO:
  - "hoje", "diário", "do dia" ⇒ periodo="hoje"
  - "ontem" ⇒ periodo="ontem"
  - "semana", "semanal", "desta semana", "da semana passada" ⇒ periodo="semana"
  - "mês", "mensal", "deste mês", "mês passado" ⇒ periodo="mes"
- Nunca retorne "null" como string. Use null literal quando não tiver valor/hora/data.
- Se indicar gasto/compra/pagamento ⇒ tipoTransacao="SAIDA".
- Se indicar recebimento/salário/venda ⇒ tipoTransacao="ENTRADA".
- Se for tarefa, ignore tipoTransacao/categoria/periodo (retorne como null).
- Categorize transações com uma das categorias conhecidas quando possível.

Mensagem: "${mensagem}"
`;


  try {
    const resposta = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: prompt,
      temperature: 0.2,
    });

    let texto = resposta.output_text?.trim() || "";
    if (!texto) return null;

    // Remove blocos markdown se vierem
    texto = texto.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();

    const json = JSON.parse(texto);

    // saneamento extra: nunca "hora":"null"
    if (json && json.hora === "null") json.hora = null;
    if (json && json.data === "null") json.data = null;

    console.log("✅ JSON interpretado:", json);
    return json;
  } catch (err: any) {
    console.error("❌ Erro ao interpretar IA:", err?.message);
    return {
      tipo: "tarefa",
      acao: "inserir",
      descricao: mensagem,
      valor: null,
      data: null,
      hora: null,
      tipoTransacao: null,
      categoria: null,
    };
  }
}
