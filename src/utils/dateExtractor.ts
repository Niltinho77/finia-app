import * as chrono from "chrono-node";
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

/**
 * Extrai data e hora de uma frase em português (ex: “amanhã às 13h”)
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

  // 🔹 Usa o parser em português
  const resultado = chrono.parseDate(t, new Date(), { forwardDate: true });

  // 🔹 Se ainda assim não reconhecer, tenta com fallback manual simples
  if (!resultado) {
    if (t.includes("amanha")) {
      const d = dayjs().add(1, "day").startOf("day");
      return { data: d.toDate(), hora: null };
    }
    if (t.includes("hoje")) {
      const d = dayjs().startOf("day");
      return { data: d.toDate(), hora: null };
    }
    return { data: null, hora: null };
  }

  // 🔧 Corrige o problema do fuso: subtrai 1 dia para alinhar com horário real do Brasil
const d = dayjs(resultado).subtract(1, "day");

const hora = d.hour() || d.minute()
  ? `${String(d.hour()).padStart(2, "0")}:${String(d.minute()).padStart(2, "0")}`
  : null;

return { data: d.toDate(), hora };
}
