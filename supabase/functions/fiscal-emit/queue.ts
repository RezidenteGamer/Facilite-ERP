/**
 * **A fila de reprocessamento agendado — A7 (09/09/2026).**
 *
 * A6 fechou a saída de uma reserva órfã (`decideConsulta` + `handleQuery`) e
 * escreveu, de propósito, onde ela parava: *"o limiar só serve para decidir
 * quando consultar sem um humano presente, e isso é agendamento — A7."*
 *
 * Este arquivo é esse limiar, e só ele. **Nenhuma decisão de A6 é reimplementada
 * aqui**: quem decide o que fazer com a resposta do provedor continua sendo
 * `decideConsulta`, em `reservation.ts`. O que mora aqui é a pergunta anterior a
 * essa — *vale a pena perguntar ao provedor sobre esta linha agora?* —, que é a
 * única decisão que o agendamento acrescenta.
 *
 * ## O que entra na fila, e o que ficou de fora
 *
 * **Entra:** a linha em `processando_autorizacao` mais velha que o limite de
 * relógio da plataforma. É reaproveitamento puro de A6 — a varredura chama
 * `provider.query(ref)` e passa a resposta por `decideConsulta`, exatamente como
 * o botão "Consultar status" faz.
 *
 * **Não entra `erro_autorizacao`**, e a razão não é de esforço: reemitir é
 * emitir um documento fiscal, e uma recusa da SEFAZ é determinística. Um NCM
 * inválido recusa igual na décima tentativa, para sempre, e no provedor real
 * cada tentativa consome crédito. O subconjunto que *seria* seguro reemitir (as
 * rejeições que a própria SEFAZ documenta como transitórias — serviço paralisado,
 * por exemplo) **não é distinguível neste código hoje**: o único `status_sefaz`
 * de emissão que existe é o `225` do provedor simulado (falha de schema, que é
 * permanente por definição), e `focusProvider` lança `FiscalNotConfiguredError`
 * nas sete operações até A12. Classificar códigos que nenhum provedor produz
 * seria escrever regra fiscal sobre suposição. Some-se a isso que toda
 * reemissão consome numeração, e a numeração ainda não é atômica (A10): um
 * laço de retentativa automática é justamente o que produz duas emissões
 * concorrentes sem ninguém olhando.
 *
 * **Não entra a venda cuja emissão nunca aconteceu** (a falha de transporte que
 * `releaseEmission` apaga sem deixar rastro). Não há o que varrer: `sales` não
 * tem nenhuma coluna que registre "o operador pediu nota" — conferido no
 * catálogo, não presumido —, então a fila não teria como distinguir essa venda
 * de qualquer venda de balcão que nunca deveria ter nota. Criar esse rastro
 * exigiria mudar `handleEmit` para gravar uma tentativa **antes** de tentar, ou
 * seja, mexer no caminho crítico que A5 e A6 acabaram de endurecer, e depois
 * emitir nota fiscal sem humano por cima da numeração não atômica de A10. O
 * botão "Emitir Nota" continua sendo a saída desse caso. Ver a entrada de A7 no
 * AGENTS.md.
 *
 * ## Por que este arquivo não tem I/O
 *
 * Mesmo motivo de `reservation.ts`: é a lógica que erra em silêncio se alguém
 * mexer, e é o único pedaço que dá para cobrir com teste sem rede
 * (`tests/unit/fiscalQueueEligibility.test.ts`). `persist.ts` importa
 * `jsr:@supabase/supabase-js@2` e não é importável de dentro do Vitest.
 */

import { RESERVA_STATUS } from "./reservation.ts";

/**
 * **Quantos milissegundos uma reserva precisa ter para a fila encostar nela.**
 *
 * 400 000 ms é o limite de *wall clock* de um worker de Edge Function da
 * Supabase (150 s no plano gratuito) — o número que A6 derivou e deixou pronto.
 * Depois dele, **nenhum isolate que estivesse emitindo ainda pode estar vivo**:
 * a plataforma o teria desligado por `WallClockTime`. Uma reserva mais nova que
 * isso pode perfeitamente ser uma emissão em voo, e perguntar ao provedor sobre
 * ela é gasto sem informação nova.
 *
 * Não é um limiar de segurança — A6 provou que consultar é seguro em qualquer
 * idade, porque a consulta não escreve nada por si. É um limiar de **economia**:
 * ele decide quando vale a pena perguntar sem um humano presente.
 *
 * O número maior (400 s, e não 150 s) é o conservador: ele vale para qualquer
 * plano. E **ele deixa de valer em A12**, quando a emissão nascer assíncrona de
 * verdade e uma reserva de horas passar a ser normal — nesse mundo o limiar não
 * decide mais "isto está órfão", e sim "já é hora da primeira pergunta". O
 * mecanismo (perguntar antes de decidir) vale nos dois.
 */
export const LIMIAR_RESERVA_ORFA_MS = 400_000;

/**
 * O intervalo do agendamento, repetido aqui porque ele é também o **primeiro
 * degrau do backoff** — não faz sentido remarcar uma tentativa para antes do
 * próximo tique.
 *
 * O `cron.schedule` que usa este número está na migration de A7; os dois
 * precisam concordar, e o comentário de lá aponta para cá.
 */
export const INTERVALO_TICK_MS = 5 * 60_000;

/** De quanto em quanto o backoff cresce a cada falha consecutiva. */
export const BACKOFF_FATOR = 3;

/**
 * O teto do backoff — e, deliberadamente, **não** um limite de tentativas.
 *
 * A pergunta "quantas vezes tentar antes de desistir" tem uma resposta ruim
 * neste domínio: desistir significa uma venda sem nota, presa em
 * `processando_autorizacao`, que nenhuma tela deixa reemitir e que ninguém está
 * vigiando. Uma requisição a cada seis horas é barata (a Focus documenta 100
 * créditos por minuto por token — ver a entrada de A7 no AGENTS.md) e cura
 * sozinha quando o provedor volta.
 *
 * O que a fila **não** faz é insistir rápido: 5 min → 15 min → 45 min → 2h15 →
 * 6h, e daí em diante 6h. `fiscal_queue.tentativas` continua contando, para que
 * um humano consiga ver que aquela linha está apanhando há dias.
 */
export const BACKOFF_TETO_MS = 6 * 60 * 60_000;

/**
 * A folga com que uma tentativa marcada é considerada vencida.
 *
 * Sem ela o backoff **nunca acerta o próprio tique**, e a conta é simples: o
 * agendador dispara às 12:00:00, a linha é processada às 12:00:02 e a próxima
 * tentativa fica marcada para 12:05:02 — dois segundos **depois** do tique das
 * 12:05:00, que portanto a pula. Cada degrau do backoff viraria em silêncio um
 * degrau mais um tique (5 min viram 10, 15 viram 20), e a escada documentada
 * aqui, na migration e no AGENTS.md descreveria um comportamento que o código
 * não tem.
 *
 * 30 s é maior que o atraso que um tique acumula (o tempo de a fila ler o banco
 * e consultar as linhas anteriores do lote) e muito menor que o menor degrau da
 * escada, então ela corrige a defasagem sem encurtar nenhum intervalo de
 * verdade.
 */
export const TOLERANCIA_AGENDAMENTO_MS = 30_000;

/**
 * Quantas linhas presas a varredura lê do banco por tique, antes de filtrar.
 *
 * É uma janela, não um limite de trabalho: dela sai o lote de fato
 * (`LOTE_MAXIMO`). Se mais de 200 documentos estiverem presos ao mesmo tempo, o
 * problema não é de fila — é sistêmico (provedor fora do ar, implantação em
 * laço) e precisa de gente, não de mais uma consulta.
 */
export const JANELA_CANDIDATOS = 200;

/**
 * Quantas consultas ao provedor a varredura faz por tique.
 *
 * 25 a cada 5 minutos cabe com folga no limite documentado da Focus (100
 * créditos por minuto por token, 1 crédito por requisição, HTTP 429 quando
 * estoura) mesmo que a emissão normal esteja acontecendo ao lado. O lote existe
 * para que um acúmulo de linhas presas não vire uma rajada.
 */
export const LOTE_MAXIMO = 25;

/**
 * O que a decisão de elegibilidade precisa saber sobre um candidato.
 *
 * Estrutural, e não a linha do PostgREST: este arquivo roda também dentro do
 * Vitest, e não pode depender de nada de `persist.ts`.
 */
export type CandidatoFila = {
  /** O status **atual** da linha de `fiscal_documents`. */
  status: string;
  /**
   * `fiscal_documents.updated_at` — quando a reserva foi tomada.
   *
   * É a coluna certa e isso foi conferido: `fiscal_documents` não tem trigger
   * nenhum, então `updated_at` só muda quando a Edge Function escreve. Na
   * reserva por `insert` ela vem do default `now()`; na reserva por
   * compare-and-swap (reemissão de nota recusada), `reserveEmission` a escreve
   * explicitamente.
   */
  reservadaEm: string;
  /** A linha de `fiscal_queue`, ou `null` se a fila nunca tocou este documento. */
  fila: { tentativas: number; proximaTentativaEm: string } | null;
};

export type ElegibilidadeDecisao = { kind: "consultar" } | { kind: "ignorar"; motivo: string };

function paraMillis(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * **Vale a pena perguntar ao provedor sobre esta linha agora?**
 *
 * Quatro recusas, nesta ordem, e nenhuma delas decide o que fazer com a
 * resposta — isso é `decideConsulta` (A6).
 *
 * 1. **A linha não está mais reservada.** Hoje a leitura já filtra por status, e
 *    portanto esta recusa não dispara — ela é a **afirmação da regra**, não um
 *    guarda contra corrida (a corrida de verdade, entre a resposta do provedor e
 *    a escrita, quem fecha é o compare-and-swap de `releaseStuckReservation`).
 *    É o que impede que afrouxar o filtro do SQL vire, sem querer, reemissão
 *    automática de `erro_autorizacao` — e é a asserção que o teste guarda.
 * 2. **A data da reserva não é legível.** Defesa em profundidade: uma data
 *    inválida faria toda comparação de idade devolver `false`, e o limiar
 *    deixaria de proteger justamente na linha mais estranha do banco.
 * 3. **A reserva ainda é nova demais.** Ver `LIMIAR_RESERVA_ORFA_MS`.
 * 4. **O backoff ainda não venceu**, com a folga de `TOLERANCIA_AGENDAMENTO_MS`
 *    — sem ela, uma tentativa marcada para daqui a exatamente um tique cairia
 *    sempre logo **depois** do tique que deveria pegá-la. A tentativa anterior
 *    falhou e remarcou.
 *
 * A varredura já lê do banco filtrando por status e por idade — mas quem decide
 * é esta função, não a consulta. O filtro no SQL existe para o lote não vir
 * cheio de linha inelegível; a regra mora aqui, onde dá para testá-la.
 */
export function decideElegibilidade(candidato: CandidatoFila, agora: Date): ElegibilidadeDecisao {
  if (candidato.status !== RESERVA_STATUS) {
    return { kind: "ignorar", motivo: "a linha não está mais reservada" };
  }

  const reservadaEm = paraMillis(candidato.reservadaEm);
  if (reservadaEm === null) {
    return { kind: "ignorar", motivo: "a data da reserva não é uma data válida" };
  }

  if (agora.getTime() - reservadaEm < LIMIAR_RESERVA_ORFA_MS) {
    return { kind: "ignorar", motivo: "a reserva ainda está dentro do limite de relógio da plataforma" };
  }

  if (candidato.fila) {
    const proxima = paraMillis(candidato.fila.proximaTentativaEm);
    // Uma data ilegível aqui **libera** a consulta, ao contrário do caso 2:
    // consultar de novo é seguro (A6), e travar uma reserva órfã para sempre por
    // causa de um campo corrompido da própria fila seria o pior dos dois erros.
    if (proxima !== null && proxima - TOLERANCIA_AGENDAMENTO_MS > agora.getTime()) {
      return { kind: "ignorar", motivo: "a próxima tentativa desta linha ainda não venceu" };
    }
  }

  return { kind: "consultar" };
}

/**
 * O lote do tique: os primeiros `limite` candidatos elegíveis, na ordem em que
 * vieram (a varredura lê do mais velho para o mais novo — quem espera há mais
 * tempo é atendido primeiro).
 *
 * Genérica sobre a linha porque o candidato de verdade carrega muito mais que a
 * decisão precisa (a `ref`, a origem, o modelo), e este arquivo não conhece esse
 * tipo de propósito.
 */
export function selecionaLote<T>(
  itens: T[],
  paraCandidato: (item: T) => CandidatoFila,
  agora: Date,
  limite: number = LOTE_MAXIMO,
): T[] {
  const lote: T[] = [];
  for (const item of itens) {
    if (lote.length >= limite) break;
    if (decideElegibilidade(paraCandidato(item), agora).kind === "consultar") lote.push(item);
  }
  return lote;
}

/** O que gravar em `fiscal_queue` depois de uma tentativa. */
export type AgendamentoFila = { tentativas: number; proximaTentativaEm: string };

/**
 * Depois de uma tentativa que **falhou** — exceção de transporte, provedor não
 * configurado, erro ao escrever.
 *
 * `tentativas` conta falhas **consecutivas**, e é ela que move o backoff:
 * 5 min, 15 min, 45 min, 2h15, e daí em diante o teto de 6h.
 */
export function agendarAposFalha(tentativasAnteriores: number, agora: Date): AgendamentoFila {
  const tentativas = Math.max(0, Math.trunc(tentativasAnteriores)) + 1;
  const espera = Math.min(
    INTERVALO_TICK_MS * Math.pow(BACKOFF_FATOR, tentativas - 1),
    BACKOFF_TETO_MS,
  );
  return {
    tentativas,
    proximaTentativaEm: new Date(agora.getTime() + espera).toISOString(),
  };
}

/**
 * Depois de uma tentativa em que o provedor respondeu, e a resposta foi **"ainda
 * estou processando"**.
 *
 * Não é falha, e por isso **zera** o contador: o provedor está vivo e falou com
 * a gente. Uma emissão que nasce assíncrona (o 202 da Focus, A12) pode ficar
 * legitimamente em voo por minutos, e tratá-la como falha faria o backoff
 * abandonar exatamente a nota que a fila existe para acompanhar até o fim.
 *
 * A próxima pergunta fica para o tique seguinte. Hoje este caminho é
 * inalcançável — o provedor simulado responde `nao_encontrado` para uma reserva
 * (`seedFromRow` devolve `[]`, decisão de A6) e a linha se resolve na primeira
 * tentativa. Ele existe para A12.
 */
export function agendarAposAguardar(agora: Date): AgendamentoFila {
  return {
    tentativas: 0,
    proximaTentativaEm: new Date(agora.getTime() + INTERVALO_TICK_MS).toISOString(),
  };
}

/**
 * O instante a partir do qual uma reserva é velha o bastante para a fila.
 *
 * Serve para a varredura já filtrar no banco em vez de trazer 200 linhas para
 * `decideElegibilidade` recusar uma a uma.
 */
export function corteDeIdade(agora: Date): string {
  return new Date(agora.getTime() - LIMIAR_RESERVA_ORFA_MS).toISOString();
}
