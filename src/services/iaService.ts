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
  terça: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

/**
 * 🧠 Extrai data e hora da mensagem ANTES da IA
 * Suporta:
 *  - 18/12, 18-12
 *  - 18/12/25, 18-12-2025
 *  - 18 de dezembro, 18 dezembro
 *  - amanhã, depois de amanhã, ontem
 *  - segunda, terça, ... domingo (próxima ocorrência)
 */
function extrairDataHora(texto: string): { data: string | null; hora: string | null } {
  const agora = dayjs();
  const lower = texto.toLowerCase();
  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let data: dayjs.Dayjs | null = null;
  let hora: string | null = null;

  // 🔢 1) Datas numéricas com DIA/MÊS/ANO (18/12/25, 18-12-2025)
  const matchCompleta = lower.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/
  );
  if (matchCompleta) {
    const dia = parseInt(matchCompleta[1], 10);
    const mes = parseInt(matchCompleta[2], 10);
    const anoRaw = matchCompleta[3];

    let ano: number;
    if (anoRaw.length === 2) {
      ano = 2000 + parseInt(anoRaw, 10); // "25" -> 2025
    } else {
      ano = parseInt(anoRaw, 10);
    }

    const parsed = dayjs(`${ano}-${mes}-${dia}`, "YYYY-M-D", true);
    if (parsed.isValid()) {
      data = parsed;
    }
  }

  // 🔢 2) Datas numéricas DIA/MÊS sem ano (18/12, 18-12)
  if (!data) {
    const matchSimples = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (matchSimples) {
      const dia = parseInt(matchSimples[1], 10);
      const mes = parseInt(matchSimples[2], 10);
      const anoAtual = agora.year();

      const parsed = dayjs(`${anoAtual}-${mes}-${dia}`, "YYYY-M-D", true);
      if (parsed.isValid()) {
        data = parsed;
      }
    }
  }

  // 🔤 3) Datas por extenso: "18 de dezembro", "18 dezembro"
  if (!data) {
    const matchExtenso = normalizado.match(
      /\b(\d{1,2})\s*(de\s+)?(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/
    );

    if (matchExtenso) {
      const dia = parseInt(matchExtenso[1], 10);
      let mesNome = matchExtenso[3]; // já sem acento

      // mapa de mês → índice (0–11)
      const mesesMap: Record<string, number> = {
        janeiro: 0,
        fevereiro: 1,
        marco: 2,
        março: 2,
        abril: 3,
        maio: 4,
        junho: 5,
        julho: 6,
        agosto: 7,
        setembro: 8,
        outubro: 9,
        novembro: 10,
        dezembro: 11,
      };

      mesNome = mesNome.replace("ç", "c");

      const mesIndex = mesesMap[mesNome];
      if (mesIndex != null) {
        const ano = agora.year();
        const parsed = dayjs().year(ano).month(mesIndex).date(dia);
        if (parsed.isValid()) {
          data = parsed;
        }
      }
    }
  }

  // 📆 4) Expressões relativas se ainda não tiver data
  if (!data) {
    // depois de amanhã
    if (normalizado.includes("depois de amanha")) {
      data = agora.add(2, "day");
    }
    // amanhã
    else if (normalizado.includes("amanha")) {
      data = agora.add(1, "day");
    }
    // ontem
    else if (normalizado.includes("ontem")) {
      data = agora.subtract(1, "day");
    }
    // dia da semana (próxima ocorrência)
    else {
      for (const [diaNome, diaNumero] of Object.entries(diasSemana)) {
        if (normalizado.includes(diaNome)) {
          const hoje = dayjs();
          const diaHoje = hoje.isoWeekday();
          let diff = diaNumero - diaHoje;
          if (diff <= 0) diff += 7; // próxima ocorrência
          data = hoje.add(diff, "day");
          break;
        }
      }
    }
  }

  // 📅 5) fallback: se nada foi detectado, usa hoje
  if (!data) {
    data = agora;
  }

  // 🕒 6) Hora: 19h, 19:30, 19h30, 7:00 etc.
  // primeiro tenta padrão com minutos explícitos (19:30, 19h30)
  let h = lower.match(/\b(\d{1,2})[:h](\d{1,2})\b/);
  if (!h) {
    // depois tenta apenas "19h" ou "19 horas"
    h = lower.match(/\b(\d{1,2})\s*(h|horas|hrs)\b/);
  }
  if (!h) {
    // fallback leve: "às 19" → 19:00
    h = lower.match(/\b(?:as|às)\s+(\d{1,2})\b/);
  }

  if (h) {
    const rawHour = h[1];
    const rawMin = h[2];

    const hh = rawHour.padStart(2, "0");
    const mm = rawMin ? rawMin.padEnd(2, "0") : "00";
    hora = `${hh}:${mm}`;
  }

  return {
    data: data ? data.format("YYYY-MM-DD") : null,
    hora,
  };
}

/** 🔥 Interpreta mensagem, mas já com data/hora resolvidas depois via extrairDataHora */
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
- Se a mensagem tiver uma data explícita como "18/12", "18/12/2025" ou "18 de dezembro", preencha "data" no formato "YYYY-MM-DD" em vez de usar apenas "periodo".
- Nunca retorne "null" como string. Use null literal quando não tiver valor/hora/data.
- Se indicar gasto/compra/pagamento ⇒ tipoTransacao="SAIDA".
- Se indicar recebimento/salário/venda ⇒ tipoTransacao="ENTRADA".
- Se for tarefa, ignore tipoTransacao/categoria/periodo (retorne como null nesses campos).
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
    texto = texto
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    const json = JSON.parse(texto);

    // saneamento extra: nunca "hora":"null" ou "data":"null"
    if (json && json.hora === "null") json.hora = null;
    if (json && json.data === "null") json.data = null;

    // 🧭 Pós-processamento: usar nosso extrairDataHora para complementar data/hora
    const { data, hora } = extrairDataHora(mensagem);

    // Só aplicamos quando a ação é "inserir", para não bagunçar consultas
    if (json && json.acao === "inserir") {
      // Se for tarefa, priorizamos muito ter data/hora corretas
      if (json.tipo === "tarefa") {
        if (!json.data && data) json.data = data;
        if (!json.hora && hora) json.hora = hora;
      } else if (json.tipo === "transacao") {
        // Em transações, é útil ter pelo menos a data explícita
        if (!json.data && data) json.data = data;
        // hora é opcional para transações, mas se o parser achar, podemos preencher
        if (!json.hora && hora) json.hora = hora;
      }
    }

    console.log("✅ JSON interpretado (ajustado):", json);
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
      periodo: null,
    };
  }
}