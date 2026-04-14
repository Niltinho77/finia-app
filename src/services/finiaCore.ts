// src/services/finiaCore.ts
import { PrismaClient, Usuario } from "@prisma/client";
import { randomBytes } from "crypto";
import fs from "fs";
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

/**
 * Gera (ou reutiliza) um link mágico seguro para o dashboard.
 *
 * - Usa o model DashboardMagicLink do Prisma:
 *   id, token, usuarioId, usado, expiraEm, criadoEm
 * - Reutiliza um link ainda válido (usado = false e expiraEm > agora)
 * - Monta a URL com base em DASHBOARD_URL ou FRONTEND_URL
 */
async function gerarDashboardMagicLink(usuario: Usuario): Promise<string> {
  const agora = dayjs();

  // 🧱 Base da URL do dashboard
  const baseUrl =
    process.env.DASHBOARD_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000";

  // remove barra no final, se tiver
  const base = baseUrl.replace(/\/+$/, "");

  // 🔁 Tenta reutilizar um link ainda válido
  const existente = await prisma.dashboardMagicLink.findFirst({
    where: {
      usuarioId: usuario.id,
      usado: false,
      expiraEm: { gt: agora.toDate() },
    },
    orderBy: { criadoEm: "desc" }, // <= bate com teu schema
  });

  if (existente) {
    return `${base}/login?token=${encodeURIComponent(existente.token)}`;
  }

  // 🔐 Gera token aleatório e expira em 30 minutos
  const token = randomBytes(32).toString("hex");
  const expiraEm = agora.add(30, "minute").toDate();

  const registro = await prisma.dashboardMagicLink.create({
    data: {
      usuarioId: usuario.id,
      token,
      expiraEm,
      // "usado" não precisa passar, já tem @default(false)
    },
  });

  // 🔗 Monta a URL final do link mágico
  return `${base}/login?token=${encodeURIComponent(registro.token)}`;
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



  // 🔹 Nomes de meses — texto já normalizado (sem acentos) pela linha 148
  const mesesMap: Record<string, number> = {
    janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  };

  for (const [nomeMes, mesIndex] of Object.entries(mesesMap)) {
    if (t.includes(nomeMes)) {
      const d = dayjs().month(mesIndex);
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
  usuario: Usuario,
  periodo: Periodo,
  filtroTipo: "ENTRADA" | "SAIDA" | null
) {
  // 🔎 Busca transações do período
  const transacoes = await prisma.transacao.findMany({
    where: {
      usuarioId: usuario.id,
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

  // 🔹 Saldo acumulado via aggregate (sem carregar todas as transações na memória)
  const saldos = await prisma.transacao.groupBy({
    by: ["tipo"],
    where: { usuarioId: usuario.id },
    _sum: { valor: true },
  });

  const totalGeralEntradas = saldos.find((s) => s.tipo === "ENTRADA")?._sum.valor ?? 0;
  const totalGeralSaidas   = saldos.find((s) => s.tipo === "SAIDA")?._sum.valor ?? 0;
  const saldoAtual = totalGeralEntradas - totalGeralSaidas;

  const periodoFmt = `${dayjs(periodo.inicio).format("DD/MM")} — ${dayjs(
    periodo.fim
  ).format("DD/MM")}`;

  // 🔹 Gera gráfico de gastos reais (SAÍDAS) no período selecionado
  try {
    const gastos = transacoes.filter(
      (t) =>
        t.tipo?.toUpperCase?.() === "SAIDA" ||
        t.tipo?.toLowerCase?.() === "saida"
    );

    if (gastos.length === 0) {
      console.log(
        "⚠️ Nenhum gasto detectado para o gráfico no período:",
        periodo.label
      );
    } else {
      const porCategoria = new Map<string, number>();

      for (const t of gastos) {
        const nomeCategoria = t.categoria?.nome?.trim() || "Outros";
        porCategoria.set(
          nomeCategoria,
          (porCategoria.get(nomeCategoria) || 0) + t.valor
        );
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
          usuario.telefone,
          chartPath,
          `📊 Seus gastos ${periodo.label} por categoria`
        );
        try { fs.unlinkSync(chartPath); } catch {}
        console.log("✅ Gráfico de gastos enviado com sucesso!");
      } else {
        console.log("⚠️ Nenhuma categoria de gasto para plotar.");
      }
    }
  } catch (err: any) {
    console.error("⚠️ Falha ao gerar/enviar gráfico:", err?.message || err);
  }

  // 🔗 Gera (ou reutiliza) link mágico para o dashboard
  let magicLinkInfo = "";
  try {
    const magicLink = await gerarDashboardMagicLink(usuario);
    magicLinkInfo =
      `\n\n🔗 *Ver detalhes no painel web:*\n` +
      `${magicLink}`;
  } catch (err: any) {
    console.error("⚠️ Erro ao gerar link mágico do dashboard:", err?.message || err);
    // se der erro, só não mostra o link – o resumo continua funcionando
  }

  // 🧾 Mensagem final simplificada
  return (
    `📊 *Resumo financeiro ${periodo.label}*\n\n` +
    `💵 *Saldo atual:* ${formatarValor(saldoAtual)}\n\n` +
    `📈 *Entradas (${periodo.label}):* ${formatarValor(totalEntradas)}\n` +
    `📉 *Saídas (${periodo.label}):* ${formatarValor(totalSaidas)}\n\n` +
    `📅 *Período:* ${periodoFmt}` +
    magicLinkInfo
  );
}


/** Monta resposta de saudação contextual com dados reais do usuário */
async function montarRespostaSaudacao(usuario: Usuario): Promise<string> {
  const agora = dayjs().tz("America/Sao_Paulo");
  const nome = usuario.nome?.split(" ")[0] || "por aí";

  // Saldo atual via aggregate
  const saldos = await prisma.transacao.groupBy({
    by: ["tipo"],
    where: { usuarioId: usuario.id },
    _sum: { valor: true },
  });
  const totalEntradas = saldos.find((s) => s.tipo === "ENTRADA")?._sum.valor ?? 0;
  const totalSaidas   = saldos.find((s) => s.tipo === "SAIDA")?._sum.valor ?? 0;
  const saldo = totalEntradas - totalSaidas;

  // Tarefas pendentes
  const tarefasPendentes = await prisma.tarefa.count({
    where: { usuarioId: usuario.id, status: "PENDENTE" },
  });

  // Última transação registrada
  const ultimaTransacao = await prisma.transacao.findFirst({
    where: { usuarioId: usuario.id },
    orderBy: { criadoEm: "desc" },
    include: { categoria: true },
  });

  // Gastos do mês atual
  const inicioMes = agora.startOf("month").toDate();
  const fimMes    = agora.endOf("month").toDate();
  const gastosmes = await prisma.transacao.aggregate({
    where: { usuarioId: usuario.id, tipo: "SAIDA", data: { gte: inicioMes, lte: fimMes } },
    _sum: { valor: true },
  });
  const totalGastosMes = gastosmes._sum.valor ?? 0;

  const ehNovo = !ultimaTransacao;

  // Cabeçalho por horário
  const hora = agora.hour();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  // Bloco de status financeiro (só se tiver dados)
  let blocoFinanceiro = "";
  if (!ehNovo) {
    blocoFinanceiro =
      `📊 *Seu resumo rápido:*\n` +
      `💰 Saldo atual: *${formatarValor(saldo)}*\n` +
      `📉 Gastos este mês: *${formatarValor(totalGastosMes)}*\n` +
      (tarefasPendentes > 0
        ? `📝 Tarefas pendentes: *${tarefasPendentes}*\n`
        : "") +
      (ultimaTransacao
        ? `🕐 Último registro: *${ultimaTransacao.descricao}* (${formatarValor(ultimaTransacao.valor)})\n`
        : "") +
      "\n";
  }

  // Bloco de plano
  let blocoPlano = "";
  if (usuario.plano === "TRIAL" && usuario.trialExpiraEm) {
    const diasRestantes = dayjs(usuario.trialExpiraEm).diff(agora, "day");
    const expiraStr = dayjs(usuario.trialExpiraEm).format("DD/MM");
    blocoPlano =
      diasRestantes <= 1
        ? `⚠️ Seu período de teste *expira hoje* (${expiraStr})! Assine para continuar:\n👉 https://finia.app/assinar\n\n`
        : `🗓️ Teste gratuito até *${expiraStr}* (${diasRestantes} dias restantes)\n\n`;
  } else if (usuario.plano === "PREMIUM" && usuario.premiumExpiraEm) {
    const expiraPremium = dayjs(usuario.premiumExpiraEm).format("DD/MM/YYYY");
    blocoPlano = `✅ Plano *Premium* ativo até ${expiraPremium}\n\n`;
  } else if (usuario.plano === "BLOQUEADO") {
    return (
      `👋 ${saudacao}, ${nome}!\n\n` +
      "⛔ Seu acesso está suspenso. Para continuar usando a Lume:\n" +
      "👉 https://finia.app/assinar"
    );
  }

  // Dica contextual inteligente
  let dica = "";
  if (ehNovo) {
    dica =
      "✨ Para começar, tente:\n" +
      "• 'Gastei 50 reais no mercado'\n" +
      "• 'Recebi meu salário de 3000'\n" +
      "• 'Lembrete: reunião amanhã às 10h'\n" +
      "• 'Resumo dos meus gastos desta semana'";
  } else if (tarefasPendentes > 0) {
    dica = "💡 Você tem tarefas pendentes. Diga *'minhas tarefas'* para ver a lista.";
  } else if (totalGastosMes > totalEntradas * 0.8 && totalEntradas > 0) {
    dica = "💡 Seus gastos estão altos este mês. Diga *'resumo do mês'* para ver o detalhamento.";
  } else {
    dica =
      "💡 Posso te ajudar com:\n" +
      "• 💸 Registrar um gasto ou ganho\n" +
      "• 📊 Ver resumo financeiro\n" +
      "• 📝 Criar tarefa ou lembrete\n" +
      "• 🖥️ Acessar o painel web";
  }

  return (
    `👋 ${saudacao}, ${nome}!\n\n` +
    blocoFinanceiro +
    blocoPlano +
    dica
  );
}

/** Core */
export async function processarComando(comando: any, telefone: string) {
  const textoBruto = comando.textoOriginal || comando.descricao || "";
  console.log("🧩 processando comando:", comando);

  const { usuario } = await validarPlano(telefone);

  // 🔒 Limite de transações registradas para usuários TRIAL
  if (usuario.plano === "TRIAL") {
    const totalTransacoes = await prisma.transacao.count({
      where: { usuarioId: usuario.id },
    });

    if (totalTransacoes >= 10) {
      const checkoutUrl = `${process.env.API_URL}/api/stripe/checkout?userId=${usuario.id}`;

        return (
          "🚫 Você atingiu o limite do teste gratuito.\n\n" +
          "💎 Assine o *FinIA Premium* e continue sem restrições:\n" +
          `👉 ${checkoutUrl}`
        );

    }
  }

  // 🔒 Regras de limitação do plano TRIAL

  const textoFiltrado = textoBruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 🔑 PEDIDO DE LINK PARA PAINEL / DASHBOARD
  const pedePainel =
    /\bpainel\b/.test(textoFiltrado) ||
    /\bdashboard\b/.test(textoFiltrado) ||
    /acesso\s+web/.test(textoFiltrado) ||
    /acessar\s+(o\s+)?painel/.test(textoFiltrado) ||
    /entrar\s+no\s+app/.test(textoFiltrado);

  if (pedePainel) {
    const link = await gerarDashboardMagicLink(usuario);

    return (
      "🖥️ *Acesso ao painel do FinIA*\n\n" +
      "Use este link seguro para acessar seu dashboard pelo navegador:\n" +
      `👉 ${link}\n\n` +
      "⚠️ Por segurança, este link expira em *30 minutos* e é exclusivo para o seu usuário."
    );
  }

  
// 👋 Palavras de saudação simples
const saudacoes = [
  "oi",
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
  "e ai",
  "e aí",
  "tudo bem",
  "blz",
  "beleza",
];

// remove pontuações básicas e espaços extras
const textoSaudacao = textoFiltrado
  .replace(/[!?,.]/g, "")
  .trim();

// Saudação simples = a mensagem é *apenas* a saudação (com ou sem variações mínimas)
const ehSaudacaoSimples = saudacoes.some((p) => {
  if (textoSaudacao === p) return true;
  if (textoSaudacao === `${p}?`) return true;
  if (textoSaudacao === `${p}!`) return true;
  return false;
});

// ✨ Se for saudação *pura* → resposta contextual com dados reais do usuário
if (ehSaudacaoSimples) {
  return await montarRespostaSaudacao(usuario);
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
    "tarefa", "tarefas", "lembrete", "anotacao", "agenda", "agende", "agendar", "adicionar", "adicione", "reuniao", "compromisso",
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


    // extrai HORA (apenas hora!) se for tarefa, usando o texto original
  if (tipo === "tarefa" && acao === "inserir") {
    const { data: dataExtraida, hora: horaExtraida } = extrairDataEHora(textoBruto);
    console.log("🧭 Debug Chrono (pré):", textoBruto, "=>", dataExtraida, horaExtraida);

    // só usamos a HORA como ajuda; a DATA vamos tratar com mais cuidado depois
    if (horaExtraida && !hora) hora = horaExtraida;
    // NÃO mexe em `data` aqui
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
          // Fallback: sem período especificado → mês atual (comportamento mais natural)
          periodoFinal = {
            inicio: agora.startOf("month").toDate(),
            fim: agora.endOf("month").toDate(),
            label: "deste mês",
          };
        }
      }

      // 3️⃣ Executa o resumo
      return await resumoTransacoes(
        usuario,
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

      // 🔠 NOMES DE MESES (texto já normalizado, sem acentos)
      else {
        const mesesMap: Record<string, number> = {
          janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
          julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
        };
        for (const [nomeMes, mesIndex] of Object.entries(mesesMap)) {
          if (texto.includes(nomeMes)) {
            const d = dayjs().month(mesIndex);
            p = {
              inicio: d.startOf("month").toDate(),
              fim: d.endOf("month").toDate(),
              label: `de ${d.format("MMMM [de] YYYY")}`,
            };
            break;
          }
        }
      }

      // 📍 Amanhã explícito
      if (!p && /\bamanh/.test(texto)) {
        p = {
          inicio: agora.add(1, "day").startOf("day").toDate(),
          fim: agora.add(1, "day").endOf("day").toDate(),
          label: "de amanhã",
        };
      }

      console.log("🧭 Período detectado para tarefas:", p);

      // Quando nenhum período foi especificado, busca todas as pendentes a partir de hoje
      const semPeriodo = !p;

      const tarefas = await prisma.tarefa.findMany({
        where: semPeriodo
          ? { usuarioId: usuario.id, status: "PENDENTE", OR: [{ data: { gte: agora.startOf("day").toDate() } }, { data: null }] }
          : { usuarioId: usuario.id, status: "PENDENTE", data: { gte: p!.inicio, lte: p!.fim } },
        orderBy: { data: "asc" },
        take: 50,
      });

      const labelPeriodo = p?.label ?? "pendentes";

        if (tarefas.length === 0) return `📭 Nenhuma tarefa ${labelPeriodo}.`;

        // Agrupa por dia
        const grupos = tarefas.reduce<Record<string, any[]>>((acc, t) => {
          const d = dayjs(t.data).format("YYYY-MM-DD");
          if (!acc[d]) acc[d] = [];
          acc[d].push(t);
          return acc;
        }, {});

        // Monta as seções por dia
        const tituloLista = semPeriodo ? "📅 *Suas tarefas pendentes:*\n\n" : `📅 *Tarefas ${labelPeriodo}:*\n\n`;
        let mensagem = tituloLista;

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

        // 🧭 usa o TEXTO ORIGINAL pra entender datas, não só a descrição "limpa" da IA
        const textoParaDatas = (textoBruto || descricao || "").toString();
        let dataTarefa: dayjs.Dayjs | null = null;
        let horaFinal: string | null = null;

        // 🕒 1) HORA: prioridade pra hora que veio da IA; se não tiver, tenta pegar do texto
        if (hora && /^\d{1,2}:\d{2}$/.test(hora)) {
          horaFinal = hora;
        } else {
          const matchHora = textoParaDatas
            .toLowerCase()
            .match(/(\d{1,2})(?:(?:h|:)(\d{0,2}))?/);
          if (matchHora) {
            const hh = matchHora[1].padStart(2, "0");
            const mm = matchHora[2] ? matchHora[2].padEnd(2, "0") : "00";
            horaFinal = `${hh}:${mm}`;
          }
        }

        // 🗓️ 2) PRIMEIRO tenta datas explícitas digitadas pelo usuário
        //     Exemplos: 18/11, 18-11-25, 18/11/2025
        const matchNum = textoParaDatas.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/
        );
        if (matchNum) {
          const dia = parseInt(matchNum[1], 10);
          const mes = parseInt(matchNum[2], 10);
          const anoAtual = agora.year();

          let ano: number;
          if (matchNum[3]) {
            const y = matchNum[3];
            ano = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
          } else {
            ano = anoAtual; // 18/11 -> ano corrente
          }

          let parsed = dayjs(`${ano}-${mes}-${dia}`, "YYYY-M-D", true);

          // Se o usuário não colocou ano e a data já passou, joga para o ano que vem
          if (!matchNum[3] && parsed.isBefore(agora, "day")) {
            parsed = parsed.add(1, "year");
          }

          if (parsed.isValid()) {
            dataTarefa = parsed;
            console.log(
              "🧭 Data detectada via formato numérico (texto original):",
              matchNum[0],
              "→",
              dataTarefa.format("DD/MM/YYYY")
            );
          }
        }

        // 🗓️ 3) Se ainda não tiver data, tenta formato por extenso: "18 de novembro", "18 novembro"
        if (!dataTarefa) {
          const textoNormalizado = textoParaDatas
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

          const matchExtenso = textoNormalizado.match(
            /\b(\d{1,2})\s*(de\s+)?(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/
          );

          if (matchExtenso) {
            const dia = parseInt(matchExtenso[1], 10);
            let mesNome = matchExtenso[3];

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
              let parsed = dayjs()
                .year(agora.year())
                .month(mesIndex)
                .date(dia);

              // se "18 de novembro" já passou este ano, joga para o ano que vem
              if (parsed.isBefore(agora, "day")) {
                parsed = parsed.add(1, "year");
              }

              if (parsed.isValid()) {
                dataTarefa = parsed;
                console.log(
                  "🧭 Data detectada via formato extenso (texto original):",
                  matchExtenso[0],
                  "→",
                  dataTarefa.format("DD/MM/YYYY")
                );
              }
            }
          }
        }

        // 🧠 4) Se ainda não tiver data explícita, aí sim confia no que a IA mandou em `data`
        if (!dataTarefa && data && dayjs(data).isValid()) {
          dataTarefa = dayjs(data);
          console.log(
            "🧭 Data recebida da IA (sem data explícita encontrada):",
            data,
            "→",
            dataTarefa.format("DD/MM/YYYY")
          );
        }

        // 🧭 5) Se mesmo assim não tiver, tenta extrair com o nosso util (chrono + -1 dia)
        if (!dataTarefa) {
          const { data: dataExtraida, hora: horaExtraida } =
            extrairDataEHora(textoParaDatas);
          console.log(
            "🧭 Debug Chrono (tarefa inserir):",
            textoParaDatas,
            "=>",
            dataExtraida,
            horaExtraida
          );

          if (dataExtraida) dataTarefa = dayjs(dataExtraida);
          if (!horaFinal && horaExtraida) horaFinal = horaExtraida ?? null;
        }

        // 🧭 6) Fallback inteligente baseado em palavras (amanhã, depois de amanhã, hoje...)
        if (!dataTarefa) {
          const textoNorm = textoParaDatas
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

          if (textoNorm.includes("depois de amanha")) {
            dataTarefa = agora.add(2, "day");
            console.log(
              "🧭 Fallback detectou 'depois de amanhã' →",
              dataTarefa.format("DD/MM/YYYY")
            );
          } else if (textoNorm.includes("amanha")) {
            dataTarefa = agora.add(1, "day");
            console.log(
              "🧭 Fallback detectou 'amanhã' →",
              dataTarefa.format("DD/MM/YYYY")
            );
          } else if (textoNorm.includes("hoje")) {
            dataTarefa = agora.startOf("day");
            console.log(
              "🧭 Fallback detectou 'hoje' →",
              dataTarefa.format("DD/MM/YYYY")
            );
          } else {
            dataTarefa = agora;
            console.log(
              "🧭 Fallback padrão: hoje →",
              dataTarefa.format("DD/MM/YYYY")
            );
          }
        }

        // 🛑 7) Correção de datas muito antigas da IA (só se ainda assim caiu no passado)
        const hoje = agora.tz("America/Sao_Paulo").startOf("day");
        const dataLocal = dataTarefa.tz("America/Sao_Paulo").startOf("day");

        // não corrige caso o usuário claramente fale de passado (ontem, semana passada, mês passado)
        const textoNormFinal = textoParaDatas
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const falaPassado =
          textoNormFinal.includes("ontem") ||
          textoNormFinal.includes("semana passada") ||
          textoNormFinal.includes("mes passado");

        if (!falaPassado && dataLocal.isBefore(hoje)) {
          console.log(
            "⚙️ Corrigindo data antiga (provavelmente erro da IA):",
            dataTarefa.format("DD/MM/YYYY"),
            "→",
            hoje.format("DD/MM/YYYY")
          );
          dataTarefa = hoje;
        }

        // cria tarefa
        await prisma.tarefa.create({
          data: {
            usuarioId: usuario.id,
            descricao,
            data: dataTarefa.toDate(),
            hora: horaFinal,
            status: "PENDENTE",
            origemTexto: textoBruto || descricao,
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
