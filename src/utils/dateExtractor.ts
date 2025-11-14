import * as chrono from "chrono-node";
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

/**
 * Extrai data e hora de uma frase em português (ex: “amanhã às 13h”
 * ou “18/12/25”, “18 de dezembro”).
 */
export function extrairDataEHora(texto: string): { data: Date | null; hora: string | null } {
  if (!texto) return { data: null, hora: null };

  // 🔹 Normaliza o texto para facilitar o parser
  const t = texto
    .toLowerCase()
    .replace("hrs", "h")
    .replace("horas", "h")
    .replace("às", "as")
    .replace(/\s+/g, " ")
    .trim();

  const agora = dayjs();

  // ===================== 1) TENTA COM CHRONO =====================
  let resultado = chrono.parseDate(t, new Date(), { forwardDate: true });

  // ===================== 2) FALLBACK MANUAL DE DATAS =====================
  if (!resultado) {
    // 2.1) Formatos numéricos: 18/12/25, 18-12-2025
    const completa = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (completa) {
      const dia = parseInt(completa[1], 10);
      const mes = parseInt(completa[2], 10);
      const anoRaw = completa[3];

      let ano: number;
      if (anoRaw.length === 2) {
        ano = 2000 + parseInt(anoRaw, 10); // "25" => 2025
      } else {
        ano = parseInt(anoRaw, 10);
      }

      const parsed = dayjs(`${ano}-${mes}-${dia}`, "YYYY-M-D", true);
      if (parsed.isValid()) {
        resultado = parsed.toDate();
      }
    }

    // 2.2) Formato simples: 18/12, 18-12 (usa ano corrente)
    if (!resultado) {
      const simples = t.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
      if (simples) {
        const dia = parseInt(simples[1], 10);
        const mes = parseInt(simples[2], 10);
        const anoAtual = agora.year();

        const parsed = dayjs(`${anoAtual}-${mes}-${dia}`, "YYYY-M-D", true);
        if (parsed.isValid()) {
          resultado = parsed.toDate();
        }
      }
    }

    // 2.3) Por extenso: "18 de dezembro", "18 dezembro"
    if (!resultado) {
      const normalizado = t
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const extenso = normalizado.match(
        /\b(\d{1,2})\s*(de\s+)?(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/
      );

      if (extenso) {
        const dia = parseInt(extenso[1], 10);
        let mesNome = extenso[3];

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
            resultado = parsed.toDate();
          }
        }
      }
    }

    // 2.4) Se ainda não achou nada, mantém os fallbacks antigos (amanhã / hoje)
    if (!resultado) {
      if (t.includes("amanha")) {
        const d = agora.add(1, "day").startOf("day");
        return { data: d.toDate(), hora: null };
      }
      if (t.includes("hoje")) {
        const d = agora.startOf("day");
        return { data: d.toDate(), hora: null };
      }
      return { data: null, hora: null };
    }
  }

  // 🔧 Corrige o problema do fuso: subtrai 1 dia (mantido como você pediu)
  const d = dayjs(resultado).subtract(1, "day");

  // 🕒 Extrai hora, se existir
  const temHora = d.hour() || d.minute();
  const hora = temHora
    ? `${String(d.hour()).padStart(2, "0")}:${String(d.minute()).padStart(2, "0")}`
    : null;

  return { data: d.toDate(), hora };
}