// src/services/finiaCore.ts
import { PrismaClient, Usuario } from "@prisma/client";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import ptBr from "dayjs/locale/pt-br.js";
import isoWeek from "dayjs/plugin/isoWeek.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { extrairDataEHora } from "../utils/dateExtractor.js";
import { gerarGraficoPizza } from "../utils/chartGenerator.js";
import { sendImageFile } from "../services/whatsappService.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("America/Sao_Paulo");
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);
dayjs.locale(ptBr);

const prisma = new PrismaClient();

// no topo do arquivo

export async function validarPlano(telefone: string): Promise<{
  autorizado: boolean;
  usuario: Usuario; // <- não-nulo
}> {
  let usuario = await prisma.usuario.findUnique({ where: { telefone } });

  const agora = dayjs();

  if (!usuario) {
    await prisma.usuario.create({
      data: {
        telefone,
        nome: `Usuário ${telefone}`,
        plano: "TRIAL",
        trialAtivadoEm: agora.toDate(),
        trialExpiraEm: agora.add(3, "day").toDate(),
      },
    });
    usuario = await prisma.usuario.findUnique({ where: { telefone } });
  }

  // 🔒 Garante não-nulo para o TS
  if (!usuario) throw new Error("Falha ao criar ou carregar o usuário.");

  // Se faltar datas, normaliza
  if (!usuario.trialAtivadoEm || !usuario.trialExpiraEm) {
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        plano: "TRIAL",
        trialAtivadoEm: agora.toDate(),
        trialExpiraEm: agora.add(3, "day").toDate(),
      },
    });
    usuario = (await prisma.usuario.findUnique({ where: { id: usuario.id } }))!;
  }

  const trialExpiraEm = usuario.trialExpiraEm;
  const premiumExpiraEm = usuario.premiumExpiraEm;

  const isTester  = usuario.tester === true;
  const isTrial   = usuario.plano === "TRIAL"   && !!trialExpiraEm   && agora.isBefore(trialExpiraEm);
  const isPremium = usuario.plano === "PREMIUM" && !!premiumExpiraEm && agora.isBefore(premiumExpiraEm);

  // Expiração (só bloqueia se já passou)
  if (usuario.plano === "PREMIUM" && premiumExpiraEm && agora.isAfter(premiumExpiraEm)) {
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { plano: "BLOQUEADO", premiumExpiraEm: null },
    });
  } else if (usuario.plano === "TRIAL" && trialExpiraEm && agora.isAfter(trialExpiraEm)) {
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { plano: "BLOQUEADO", trialExpiraEm: null },
    });
  }

  return { autorizado: isTester || isTrial || isPremium, usuario };
}



/** Utils */
function formatarValor(valor: number | null) {
  if (valor == null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Periodo = { inicio: Date; fim: Date; label: string };

function detectarPeriodo(texto: string): Periodo | null {
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const agora = dayjs();

  // 🔹 Hoje / Amanhã / Ontem
  if (/\bhoje\b/.test(t))
    return { inicio: agora.startOf("day").toDate(), fim: agora.endOf("day").toDate(), label: "hoje" };

  if (/\bamanh/.test(t)) {
    const d = agora.add(1, "day");
    return { inicio: d.startOf("day").toDate(), fim: d.endOf("day").toDate(), label: "amanhã" };
  }

  if (/\bontem\b/.test(t)) {
    const d = agora.subtract(1, "day");
    return { inicio: d.startOf("day").toDate(), fim: d.endOf("day").toDate(), label: "ontem" };
  }

  // 🔹 Semana passada (verifica primeiro para evitar conflito)
    if (/\bsemana\s+passada\b/.test(t)) {
      const d = agora.subtract(1, "week");
      return {
        inicio: d.startOf("isoWeek").toDate(),
        fim: d.endOf("isoWeek").toDate(),
        label: "da semana passada",
      };
    }

    // 🔹 Próxima semana
    if (/\bproxima\s+semana\b|\bpr[oó]xima\s+semana\b/.test(t)) {
      const d = agora.add(1, "week");
      return {
        inicio: d.startOf("isoWeek").toDate(),
        fim: d.endOf("isoWeek").toDate(),
        label: "da próxima semana",
      };
    }

    // 🔹 Semana atual / essa / dessa / desta / da semana
    if (/\b(esta|essa|desta|dessa)\s+semana\b|\bsemana\s+atual\b|\bda\s+semana\b/.test(t)) {
      const d = agora;
      return {
        inicio: d.startOf("isoWeek").toDate(),
        fim: d.endOf("isoWeek").toDate(),
        label: "desta semana",
      };
    }



  // 🔹 Nomes de meses (com correção de -1 mês)
  const meses = [
    "janeiro","fevereiro","março","marco","abril","maio","junho",
    "julho","agosto","setembro","outubro","novembro","dezembro",
  ];

  for (let i = 0; i < meses.length; i++) {
    if (t.includes(meses[i])) {
      const ano = dayjs().year();
      const d = dayjs(`${ano}-01-01`).month(i).subtract(1, "month");
      return {
        inicio: d.startOf("month").toDate(),
        fim: d.endOf("month").toDate(),
        label: `de ${d.format("MMMM [de] YYYY")}`,
      };
    }
  }

  // 🔹 Mês atual / passado
  if (/\bmes\s+passado\b/.test(t)) {
    const d = agora.subtract(1, "month");
    return { inicio: d.startOf("month").toDate(), fim: d.endOf("month").toDate(), label: `de ${d.format("MMMM")}` };
  }

  if (/\best(e|a)\s+mes\b|\bdo\s+mes\b|\bm[eê]s\b/.test(t)) {
    const d = agora;
    return { inicio: d.startOf("month").toDate(), fim: d.endOf("month").toDate(), label: `de ${d.format("MMMM")}` };
  }

  return null;
}



function inferirTipoPorPalavras(texto: string): "ENTRADA" | "SAIDA" | null {
  const t = texto.toLowerCase();
  if (/(gastos?|despesas?|paguei|compra|pagar|debito|d[eé]bito)/.test(t)) return "SAIDA";
  if (/(ganhos?|recebi|sal[aá]rio|venda|deposit|credito|cr[eé]dito)/.test(t)) return "ENTRADA";
  return null;
}


async function resumoTransacoes(
  usuarioId: string,
  usuarioTelefone: string,
  periodo: Periodo,
  filtroTipo: "ENTRADA" | "SAIDA" | null
) {
  // 🔎 Busca transações do período
  const transacoes = await prisma.transacao.findMany({
    where: {
      usuarioId,
      data: { gte: periodo.inicio, lte: periodo.fim },
      valor: { gt: 0 },
    },
    include: { categoria: true },
  });

  if (transacoes.length === 0) {
    const tipoTexto =
      filtroTipo === "SAIDA"
        ? "gastos"
        : filtroTipo === "ENTRADA"
        ? "entradas"
        : "movimentações";
    return `📭 Nenhum(a) ${tipoTexto} ${periodo.label}.`;
  }

  // 🔹 Totais do período
  const totalEntradas = transacoes
    .filter((t) => t.tipo === "ENTRADA")
    .reduce((s, t) => s + t.valor, 0);

  const totalSaidas = transacoes
    .filter((t) => t.tipo === "SAIDA")
    .reduce((s, t) => s + t.valor, 0);

  // 🔹 Totais gerais (saldo acumulado)
  const todasTransacoes = await prisma.transacao.findMany({
    where: { usuarioId },
  });

  const totalGeralEntradas = todasTransacoes
    .filter((t) => t.tipo === "ENTRADA")
    .reduce((s, t) => s + t.valor, 0);

  const totalGeralSaidas = todasTransacoes
    .filter((t) => t.tipo === "SAIDA")
    .reduce((s, t) => s + t.valor, 0);

  const saldoAtual = totalGeralEntradas - totalGeralSaidas;

  const periodoFmt = `${dayjs(periodo.inicio).format("DD/MM")} — ${dayjs(
    periodo.fim
  ).format("DD/MM")}`;

  // 🔹 Gera gráfico de gastos reais (SAÍDAS) no período selecionado
try {
  const gastos = transacoes.filter(
    (t) => t.tipo?.toUpperCase?.() === "SAIDA" || t.tipo?.toLowerCase?.() === "saida"
  );

  if (gastos.length === 0) {
    console.log("⚠️ Nenhum gasto detectado para o gráfico no período:", periodo.label);
  } else {
    const porCategoria = new Map<string, number>();

    for (const t of gastos) {
      const nomeCategoria = t.categoria?.nome?.trim() || "Outros";
      porCategoria.set(nomeCategoria, (porCategoria.get(nomeCategoria) || 0) + t.valor);
    }

    const topCategorias = [...porCategoria.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8); // mostra até 8 categorias

    const categorias = topCategorias.map(([nome]) => nome);
    const valores = topCategorias.map(([, v]) => v);

    // sempre gera, mesmo com uma categoria
    if (categorias.length > 0) {
      const chartPath = await gerarGraficoPizza(categorias, valores);
      await sendImageFile(
        usuarioTelefone,
        chartPath,
        `📊 Seus gastos ${periodo.label} por categoria`
      );
      console.log("✅ Gráfico de gastos enviado com sucesso!");
    } else {
      console.log("⚠️ Nenhuma categoria de gasto para plotar.");
    }
  }
} catch (err: any) {
  console.error("⚠️ Falha ao gerar/enviar gráfico:", err?.message || err);
}


  // 🧾 Mensagem final simplificada
  return `📊 *Resumo financeiro ${periodo.label}*

💵 *Saldo atual:* ${formatarValor(saldoAtual)}

📈 *Entradas (${periodo.label}):* ${formatarValor(totalEntradas)}
📉 *Saídas (${periodo.label}):* ${formatarValor(totalSaidas)}

📅 *Período:* ${periodoFmt}`;
}



/** Core */
export async function processarComando(comando: any, telefone: string) {
  const textoBruto = comando.textoOriginal || comando.descricao || "";
  console.log("🧩 processando comando:", comando);

  const { usuario } = await validarPlano(telefone);

  // 🔒 Regras de limitação do plano TRIAL

const textoFiltrado = textoBruto
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

// 👋 Palavras de saudação simples
const saudacoes = ["oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "e ai", "tudo bem", "blz", "beleza"];

const ehSaudacaoSimples = saudacoes.some(p => textoFiltrado === p || textoFiltrado.includes(p));

// ✨ Se for saudação → envia mensagem de boas-vindas
if (ehSaudacaoSimples) {
  const trialFim = usuario.trialExpiraEm
    ? dayjs(usuario.trialExpiraEm).format("DD/MM")
    : dayjs().add(3, "day").format("DD/MM");

  return (
    "👋 Olá! Eu sou a *Lume*, sua assistente financeira. 😊\n\n" +
    "Você está no seu período de *teste gratuito*!\n" +
    `🗓️ Ele expira em *${trialFim}*.\n\n` +
    "Posso te ajudar com:\n" +
    "• 💸 Registrar um gasto ou ganho\n" +
    "• 📊 Ver seu resumo financeiro\n" +
    "• 📝 Criar uma tarefa com horário\n\n" +
    "Tente enviar algo como:\n" +
    "• 'Gastei 50 com gasolina'\n" +
    "• 'Quanto gastei este mês?'\n" +
    "• 'Lavar o carro amanhã às 13h'\n\n" +
    "👉 Quando quiser liberar tudo, ative o plano PREMIUM em https://finia.app/assinar"
  );
}

  // 💰 Palavras relacionadas a finanças
  const palavrasFinanceiras = [
    "gasto", "gastei", "despesa", "compra", "comprei", "paguei", "pagamento", "conta", "pix",
    "transferencia", "deposito", "credito", "debito", "entrada", "recebi", "ganhei",
    "salario", "venda", "lucro", "faturamento", "investimento", "resumo", "extrato",
    "relatorio", "balanco", "saldo", "total", "analise", "grafico"
  ];

  // 📅 Palavras relacionadas a tarefas / rotina / agendamento
  const palavrasTarefas = [
    "tarefa", "tarefas", "lembrete", "anotacao", "agenda", "reuniao", "compromisso",
    "evento", "planejar", "planejamento", "meta", "objetivo", "fazer", "lavar", "estudar",
    "ir", "buscar", "ligar", "enviar", "organizar", "preparar", "visitar", "lembrar",
    "amanha", "hoje", "ontem", "semana", "mes", "horario", "hora", "data"
  ];

  // 👋 Palavras sem relevância (cumprimentos e ruídos)
  const palavrasIrrelevantes = [
    "oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "e ai", "tudo bem",
    "blz", "beleza", "kk", "kkk", "haha", "rs", "rsrs", "ok", "👍", "tchau", "vlw"
  ];

  // Verifica se é uma interação de contexto útil
  const ehFinanceiro = palavrasFinanceiras.some(p => textoFiltrado.includes(p));
  const ehTarefa = palavrasTarefas.some(p => textoFiltrado.includes(p));
  const ehSaudacao = palavrasIrrelevantes.some(p => textoFiltrado.includes(p));

  // 🔎 Se não for financeiro nem tarefa (e também não saudação curta) → resposta padrão
  if (!ehFinanceiro && !ehTarefa) {
    // evita responder algo bobo tipo "kk" com o texto longo
    if (ehSaudacao || textoFiltrado.length < 5) {
      return "👋 Oi! Tudo bem? Pode me dizer o que deseja fazer? 😊";
    }

    return (
      "🤖 Oi! Eu sou a *Lume*, sua assistente financeira. 😊\n\n" +
      "Posso te ajudar a *registrar um gasto ou ganho*, *consultar seu resumo financeiro* ou *criar uma tarefa*.\n" +
      "Exemplos:\n" +
      "• 💸 'Gastei 50 reais com mercado'\n" +
      "• 📊 'Quanto gastei este mês?'\n" +
      "• 🧽 'Lavar o carro amanhã às 13h'\n" +
      "• 📅 'Adicionar reunião terça às 10h'\n\n" +
      "Tente mandar algo nesse formato que eu entendo rapidinho!"
    );
  }


  // 🧾 Verifica plano e aplica limites do plano FREE
  const agora = dayjs();
  const isTrial = usuario.plano === "TRIAL" && usuario.trialExpiraEm && agora.isBefore(usuario.trialExpiraEm);
  const isPremium = usuario.plano === "PREMIUM" && usuario.premiumExpiraEm && agora.isBefore(usuario.premiumExpiraEm);
  const isTester = usuario.plano === "TESTER" || usuario.tester === true;
  const isBloqueado = usuario.plano === "BLOQUEADO" && !isTester;

  const planoAtivo = isTrial || isPremium || isTester;

  
  let { tipo, acao, descricao, valor, data, hora, tipoTransacao, categoria } = comando;

  // 🔒 Aplicar limites APÓS o comando estar normalizado
if (usuario.plano === "TRIAL") {
  // Conta o total de registros do usuário
  const totalTransacoes = await prisma.transacao.count({
    where: { usuarioId: usuario.id },
  });

  const totalRelatorios = await prisma.interacaoIA.count({
    where: { usuarioId: usuario.id, tipo: "CONSULTA" },
  });

  const totalAudios = await prisma.interacaoIA.count({
    where: {
      usuarioId: usuario.id,
      tipo: "OUTRO",
      entradaTexto: { contains: "(audio" }, // identifica interações de voz
    },
  });

  // 💸 1️⃣ Limite de lançamentos
  if (tipo === "transacao" && acao === "inserir" && totalTransacoes >= 10) {
    return (
      "📈 Você atingiu o limite de *10 lançamentos* do teste gratuito.\n\n" +
      "💎 *Ative o Plano PREMIUM* e continue registrando seus gastos:\n" +
      "👉 https://finia.app/assinar"
    );
  }

  // 📊 2️⃣ Limite de relatórios
  if (tipo === "transacao" && acao === "consultar" && totalRelatorios >= 1) {
    return (
      "📊 Você já utilizou o seu *relatório gratuito* do teste.\n\n" +
      "💎 Assine o *Plano PREMIUM* para relatórios ilimitados:\n" +
      "👉 https://finia.app/assinar"
    );
  }

  // 🎙️ 3️⃣ Limite de áudios
  // (detecta que a mensagem veio de áudio pelo texto da transcrição ou interações anteriores)
  if (comando.textoOriginal?.startsWith("(audio") && totalAudios >= 2) {
    return (
      "🎧 Você já usou seus *2 áudios gratuitos* do teste.\n\n" +
      "💎 Ative o *Plano PREMIUM* para continuar usando comandos por voz:\n" +
      "👉 https://finia.app/assinar"
    );
  }
}


  // 🔒 Bloqueios e limites do plano FREE
  if (!planoAtivo) {
    return (
      "🚫 *Seu plano expirou!*\n\n" +
      "💎 Ative o *Plano PREMIUM* para continuar usando o Finia sem limites:\n" +
      "👉 https://finia.app/assinar"
    );
  }

  if (isTrial) {
    const totalTransacoes = await prisma.transacao.count({ where: { usuarioId: usuario.id } });
    if (totalTransacoes >= 10) {
      return (
        "📈 Você atingiu o limite de 10 transações do período de teste.\n" +
        "💎 *Ative o Plano PREMIUM* e continue registrando seus gastos:\n" +
        "👉 https://finia.app/assinar"
      );
    }
  }


  // extrai data e hora se for tarefa
  if (tipo === "tarefa" && acao === "inserir") {
    const { data: dataExtraida, hora: horaExtraida } = extrairDataEHora(descricao);
    console.log("🧭 Debug Chrono:", descricao, "=>", dataExtraida, horaExtraida);

    if (dataExtraida && !data) data = dataExtraida;
    if (horaExtraida && !hora) hora = horaExtraida;
  }

  const textoOriginal = `${descricao || ""}`.toLowerCase().trim();

  // 🚧 Guard: se for transação SEM valor => trate como CONSULTA/RESUMO
  if (tipo === "transacao" && (valor == null || Number.isNaN(valor))) {
    acao = "consultar";
  }

  // 🧭 Detecta período (hoje, amanhã, este mês, mês passado, nomes de meses, etc.)
  const periodo = detectarPeriodo(textoOriginal);

  // 🧮 Infere tipo por semântica (“gastos” => SAIDA, “ganhos” => ENTRADA) quando for consulta
  const tipoInferido = acao === "consultar" ? inferirTipoPorPalavras(textoOriginal) : null;

  try {
    /** ============== TRANSACOES ============== */
    if (tipo === "transacao") {
      // ================= CONSULTAR =================
    if (acao === "consultar") {
      // 🧭 1️⃣ Detecta o período textual ou o enviado pela IA
      let periodoFinal = detectarPeriodo(textoOriginal);
      const agora = dayjs();

      // Se a IA tiver retornado "periodo": "semana" | "mes" | "hoje" | "ontem", trata aqui
      if (!periodoFinal && comando.periodo) {
        switch (comando.periodo) {
          case "semana":
            periodoFinal = {
              inicio: agora.startOf("isoWeek").toDate(),
              fim: agora.endOf("isoWeek").toDate(),
              label: "desta semana",
            };
            break;

          case "mes":
            periodoFinal = {
              inicio: agora.startOf("month").toDate(),
              fim: agora.endOf("month").toDate(),
              label: "deste mês",
            };
            break;

          case "ontem":
            periodoFinal = {
              inicio: agora.subtract(1, "day").startOf("day").toDate(),
              fim: agora.subtract(1, "day").endOf("day").toDate(),
              label: "de ontem",
            };
            break;

          case "hoje":
          default:
            periodoFinal = {
              inicio: agora.startOf("day").toDate(),
              fim: agora.endOf("day").toDate(),
              label: "de hoje",
            };
            break;
        }
      }

      // 2️⃣ Fallback padrão — se nada foi detectado
      if (!periodoFinal) {
        const t = textoOriginal;
        if (/\bseman(a|al)\b/.test(t)) {
          periodoFinal = {
            inicio: agora.startOf("isoWeek").toDate(),
            fim: agora.endOf("isoWeek").toDate(),
            label: "desta semana",
          };
        } else if (/\bm(e|ê)s\b|\bmensal\b/.test(t)) {
          periodoFinal = {
            inicio: agora.startOf("month").toDate(),
            fim: agora.endOf("month").toDate(),
            label: "deste mês",
          };
        } else {
          periodoFinal = {
            inicio: agora.startOf("day").toDate(),
            fim: agora.endOf("day").toDate(),
            label: "de hoje",
          };
        }
      }

      // 3️⃣ Executa o resumo
      return await resumoTransacoes(
        usuario.id,
        usuario.telefone,
        periodoFinal,
        tipoInferido
      );
    }


      // ================= INSERIR =================
      if (acao === "inserir") {
        const categoriaNomeOriginal = categoria || "Outros";
        const categoriaNormalizada = categoriaNomeOriginal
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toLowerCase();

        const categorias = await prisma.categoria.findMany();
        let categoriaEncontrada = categorias.find(
          (c) =>
            c.nome
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase() === categoriaNormalizada
        );

        if (!categoriaEncontrada) {
          const nomeCapitalizado =
            categoriaNomeOriginal.charAt(0).toUpperCase() +
            categoriaNomeOriginal.slice(1).toLowerCase();

          categoriaEncontrada = await prisma.categoria.create({
            data: {
              nome: nomeCapitalizado,
              tipo: tipoTransacao === "ENTRADA" ? "ENTRADA" : "SAIDA",
              icone: tipoTransacao === "ENTRADA" ? "📥" : "📤",
              cor: tipoTransacao === "ENTRADA" ? "#22c55e" : "#ef4444",
            },
          });
        }

        await prisma.transacao.create({
          data: {
            usuarioId: usuario.id,
            descricao,
            valor: valor ?? 0,
            tipo: tipoTransacao === "ENTRADA" ? "ENTRADA" : "SAIDA",
            data: data ? new Date(data) : new Date(),
            categoriaId: categoriaEncontrada.id,
            origemTexto: descricao,
          },
        });

        const tipoEmoji =
          tipoTransacao === "ENTRADA" ? "📥" : "📤";

        return `✅ *Registrado com sucesso!*
${tipoEmoji} *Tipo:* ${
          tipoTransacao === "ENTRADA" ? "Entrada" : "Saída"
        }
📝 *Descrição:* ${descricao}
💰 *Valor:* ${formatarValor(valor)}
🏷️ *Categoria:* ${categoriaEncontrada.nome}`;
      }
    }
 
    /** ============== TAREFAS (sem alterações nesta parte) ============== */
    if (tipo === "tarefa") {
      if (acao === "consultar") {
        // Se o texto mencionar "semana", use intervalo completo
        // 🧠 Detecta períodos de tempo de forma mais inteligente
      const texto = textoOriginal
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const agora = dayjs();
      let p: Periodo | null = null;

      // 🗓️ SEMANA
      if (/\bsemana\s+passada\b/.test(texto)) {
        const d = agora.subtract(1, "week");
        p = {
          inicio: d.startOf("isoWeek").toDate(),
          fim: d.endOf("isoWeek").toDate(),
          label: "da semana passada",
        };
      } else if (/\bproxima\s+semana\b/.test(texto)) {
        const d = agora.add(1, "week");
        p = {
          inicio: d.startOf("isoWeek").toDate(),
          fim: d.endOf("isoWeek").toDate(),
          label: "da próxima semana",
        };
      } else if (/\b(esta|essa|desta|dessa)\s+semana\b|\bsemana\s+atual\b|\bda\s+semana\b/.test(texto)) {
        const d = agora;
        p = {
          inicio: d.startOf("isoWeek").toDate(),
          fim: d.endOf("isoWeek").toDate(),
          label: "desta semana",
        };
      }

      // 📅 MÊS
      else if (/\bmes\s+passado\b/.test(texto)) {
        const d = agora.subtract(1, "month");
        p = {
          inicio: d.startOf("month").toDate(),
          fim: d.endOf("month").toDate(),
          label: `do mês passado (${d.format("MMMM")})`,
        };
      } else if (/\bproximo\s+mes\b/.test(texto)) {
        const d = agora.add(1, "month");
        p = {
          inicio: d.startOf("month").toDate(),
          fim: d.endOf("month").toDate(),
          label: `do próximo mês (${d.format("MMMM")})`,
        };
      } else if (/\b(este|esse|deste|desse)\s+mes\b|\bmes\s+atual\b|\bdo\s+mes\b/.test(texto)) {
        const d = agora;
        p = {
          inicio: d.startOf("month").toDate(),
          fim: d.endOf("month").toDate(),
          label: `deste mês (${d.format("MMMM")})`,
        };
      }

      // 🔠 NOMES DE MESES
      else {
        const meses = [
          "janeiro","fevereiro","marco","março","abril","maio","junho",
          "julho","agosto","setembro","outubro","novembro","dezembro"
        ];
        for (let i = 0; i < meses.length; i++) {
          if (texto.includes(meses[i])) {
            const ano = agora.year();
            const d = dayjs(`${ano}-01-01`).month(i);
            p = {
              inicio: d.startOf("month").toDate(),
              fim: d.endOf("month").toDate(),
              label: `de ${d.format("MMMM [de] YYYY")}`,
            };
            break;
          }
        }
      }

      // 📍 Fallback — hoje / amanhã
      if (!p) {
        p =
          /\bamanh/.test(texto)
            ? {
                inicio: agora.add(1, "day").startOf("day").toDate(),
                fim: agora.add(1, "day").endOf("day").toDate(),
                label: "de amanhã",
              }
            : {
                inicio: agora.startOf("day").toDate(),
                fim: agora.endOf("day").toDate(),
                label: "de hoje",
              };
      }

      console.log("🧭 Período detectado para tarefas:", p);

        const tarefas = await prisma.tarefa.findMany({
          where: { usuarioId: usuario.id, status: "PENDENTE", data: { gte: p.inicio, lte: p.fim } },
          orderBy: { data: "asc" },
          take: 50,
        });

        if (tarefas.length === 0) return `📭 Nenhuma tarefa ${p.label}.`;

        // Agrupa por dia
        const grupos = tarefas.reduce<Record<string, any[]>>((acc, t) => {
          const d = dayjs(t.data).format("YYYY-MM-DD");
          if (!acc[d]) acc[d] = [];
          acc[d].push(t);
          return acc;
        }, {});

        // Monta as seções por dia
        let mensagem = "📅 *Suas próximas tarefas:*\n\n";

        const diasOrdenados = Object.keys(grupos).sort();

        for (const dia of diasOrdenados) {
          const d = dayjs(dia);
          let titulo: string;

          if (d.isSame(dayjs(), "day")) titulo = "📆 *Hoje*";
          else if (d.isSame(dayjs().add(1, "day"), "day")) titulo = "📆 *Amanhã*";
          else titulo = `📆 *${d.format("dddd, DD/MM")}*`;

          mensagem += `${titulo}\n`;

          grupos[dia].forEach((t) => {
            mensagem += `• ${t.descricao}${t.hora ? ` ⏰ ${t.hora}` : ""}\n`;
          });

          mensagem += "\n";
        }

        return mensagem.trim();
      }

      if (tipo === "tarefa" && acao === "inserir") {
      const agora = dayjs(); // já com America/Sao_Paulo

      // 🧭 usa data/hora da IA, se vierem preenchidas
      let dataTarefa: dayjs.Dayjs | null = null;
      let horaFinal: string | null = null;

      if (data && dayjs(data).isValid()) {
        dataTarefa = dayjs(data);
        console.log("🧭 Data recebida da IA:", data, "→ após correção:", dataTarefa.format("DD/MM/YYYY"));

      } else {
        // tenta extrair localmente, se a IA não tiver mandado
        const { data: dataExtraida, hora: horaExtraida } = extrairDataEHora(descricao);
        console.log("🧭 Debug Chrono:", descricao, "=>", dataExtraida, horaExtraida);

        if (dataExtraida) dataTarefa = dayjs(dataExtraida);
        horaFinal = horaExtraida ?? null;
      }

      // se mesmo assim não encontrou data, usa hoje
      // 🧭 fallback inteligente baseado em palavras (com normalização de acentos)
      if (!dataTarefa) {
        const texto = textoBruto
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();


        if (texto.includes("depois de amanha")) {
          dataTarefa = agora.add(2, "day");
          console.log("🧭 Fallback detectou 'depois de amanhã' →", dataTarefa.format("DD/MM/YYYY"));
        } else if (texto.includes("amanha")) {
          dataTarefa = agora.add(1, "day");
          console.log("🧭 Fallback detectou 'amanhã' →", dataTarefa.format("DD/MM/YYYY"));
        } else if (texto.includes("hoje")) {
          dataTarefa = agora.startOf("day");
          console.log("🧭 Fallback detectou 'hoje' →", dataTarefa.format("DD/MM/YYYY"));
        } else {
          dataTarefa = agora;
          console.log("🧭 Fallback padrão: hoje →", dataTarefa.format("DD/MM/YYYY"));
        }
      }


      // se ainda não tem hora, usa a que veio do JSON
      if (!horaFinal && hora && /^\d{1,2}:\d{2}$/.test(hora)) horaFinal = hora;

      // ✅ Corrige apenas se a data for *antes* de hoje (não o mesmo dia)
      const hoje = agora.tz("America/Sao_Paulo").startOf("day");
      const dataLocal = dataTarefa.tz("America/Sao_Paulo").startOf("day");

      if (dataLocal.isBefore(hoje)) {
        console.log("⚙️ Corrigindo data antiga da IA:", dataTarefa.format("DD/MM/YYYY"), "→", hoje.format("DD/MM/YYYY"));
        dataTarefa = hoje; // usa o dia atual, não amanhã
      }



      // cria tarefa
      await prisma.tarefa.create({
        data: {
          usuarioId: usuario.id,
          descricao,
          data: dataTarefa.toDate(),
          hora: horaFinal,
          status: "PENDENTE",
          origemTexto: descricao,
        },
      });

      // formata resposta amigável
      let dataFmt = dataTarefa.format("dddd, DD/MM");
      if (horaFinal) dataFmt += ` às ${horaFinal}`;

      return `📝 *Tarefa adicionada com sucesso!*
    📌 ${descricao}
    🕒 ${dataFmt}`;
    }

        }
  


    return "🤔 Não consegui entender bem o que você quis dizer. Pode reformular?";
  } catch (error) {
    console.error("❌ Erro ao processar comando:", error);
    return "⚠️ Ocorreu um erro ao processar sua solicitação.";
  }
}
