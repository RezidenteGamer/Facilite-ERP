/**
 * **A trava de emissão no banco — a segunda metade de A5 (07/09/2026).**
 *
 * A primeira metade veio em A1: a `ref` deixou de ser informada pelo cliente e
 * passou a ser derivada do id da venda ou da devolução dentro da própria Edge
 * Function (`refFor` em `index.ts`, `_shared/fiscal/refs.ts`). O que faltava
 * era travá-la **no banco**, e não só derivá-la.
 *
 * ## A corrida que existia
 *
 * `handleEmit` fazia, nesta ordem: `readDocumentByRef` (leitura) →
 * `buildPayload` → `provider.emit()` → `persistEmission` (escrita). Entre a
 * leitura e a escrita há trabalho assíncrono de verdade — três consultas de
 * cadastro, a leitura da venda e a chamada ao provedor. Duas requisições de
 * emissão para a **mesma venda** que cheguem dentro dessa janela (duplo clique,
 * retry de rede, o front chamando duas vezes) passam as duas pela leitura antes
 * de qualquer uma escrever, e as duas seguem para `provider.emit()`.
 *
 * O estrago não era teórico:
 *
 * - **No provedor simulado**, `handleEmit` constrói uma instância nova por
 *   requisição (`createProvider`), então o `Map` de `documents` que faz a
 *   idempotência por `ref` dentro de `emit()` nasce vazio nas duas — a proteção
 *   não vale entre requisições concorrentes nem dentro do mesmo isolate. As
 *   duas emitem: mesmo `numero` (as duas leram o mesmo `readLastNumero`) e
 *   **chaves de acesso diferentes**, porque o `cNF` da chave é sorteado.
 * - **Em `persistEmission`**, o `upsert(..., { onConflict: "ref" })` não falha
 *   com violação de unicidade: ele **sobrescreve**. A segunda escrita apaga a
 *   chave da primeira. Se a primeira já tinha sido autorizada de verdade, a
 *   nota existe para a SEFAZ e a chave dela sumiu do nosso lado.
 *
 * ## A correção
 *
 * A primeira escrita passa a ser uma **reserva atômica**, antes de qualquer
 * chamada ao provedor: uma linha em `fiscal_documents` com
 * `status = 'processando_autorizacao'`. Quem consegue gravá-la emite; quem
 * esbarra na unicidade perdeu a corrida, **não chama o provedor** e responde
 * com o que a linha já diz (`decideAposPerderCorrida`). É o mesmo princípio do
 * `select ... for update` de C4: quem decide o efeito é o banco, não a ordem em
 * que dois processos leram.
 *
 * ## Por que este arquivo é só decisão, sem I/O
 *
 * As duas escritas atômicas moram em `persist.ts` (`reserveEmission` e
 * `releaseEmission`), junto do resto do que fala com o Postgres. Aqui ficam as
 * tabelas de decisão puras — o que responder para cada estado que a linha pode
 * ter, antes e depois da corrida. Separadas por dois motivos:
 *
 * 1. É onde está a lógica que erra silenciosamente se alguém mexer, e o único
 *    pedaço que dá para cobrir com teste sem rede (`tests/unit/
 *    fiscalEmitReservation.test.ts`). `persist.ts` importa
 *    `jsr:@supabase/supabase-js@2` e não é importável de dentro do Vitest.
 * 2. `handleEmit` fica sendo despacho, e a tabela de estados fica legível de
 *    uma vez só — que é o que uma revisão de motor fiscal precisa ler.
 *
 * ## O que é de A6, e não daqui
 *
 * `processando_autorizacao` passa a ser escrito, mas **só como reserva
 * transitória dentro da própria requisição HTTP**: os dois provedores de hoje
 * respondem de forma síncrona, e toda saída de `handleEmit` ou sobrescreve a
 * reserva com o desfecho (`persistEmission`) ou a desfaz (`releaseEmission`).
 * Uma nota que fique *pendurada* nesse estado entre requisições — o que a
 * emissão assíncrona do provedor real vai produzir de propósito (202 agora,
 * autorização depois) —, a transição para `denegado` e o reprocessamento
 * agendado são A6 e A7. Ver a entrada de A5 no AGENTS.md.
 *
 * ## O que A6 (09/09/2026) acrescentou, e o que corrigiu do parágrafo acima
 *
 * O invariante de A5 vale para o **código**, não para a execução: um isolate
 * morto por limite de CPU, de memória ou por uma implantação não roda o `catch`
 * de `handleEmit`, e a reserva fica órfã **hoje**, com os provedores síncronos.
 * A segunda metade deste arquivo (`decideConsulta`) é a resolução dessa reserva
 * — sempre perguntando ao provedor antes de liberar —, e é também onde
 * `denegado` finalmente passa a ser escrito. Ver o bloco "A resolução de uma
 * reserva presa", mais abaixo.
 */

import type { FiscalModel } from "../_shared/fiscal/types.ts";

/** O status que a reserva grava — e o único que esta tarefa passa a escrever. */
export const RESERVA_STATUS = "processando_autorizacao";

/**
 * O que a decisão precisa saber da linha de `fiscal_documents`.
 *
 * Estrutural, e não `FiscalDocumentRow` importado de `persist.ts`: aquele
 * arquivo traz `jsr:@supabase/supabase-js@2` junto, e este precisa rodar
 * também dentro do Vitest. `FiscalDocumentRow` satisfaz este tipo.
 */
export type EmissaoSnapshot = {
  status: string;
  model: FiscalModel;
  chave: string | null;
  mensagem_sefaz: string | null;
};

/** O corpo de uma resposta `EmitOutcome` — `ok` sai de `errors.length`. */
export type EmissaoResposta = { errors: string[]; extra: Record<string, unknown> };

/**
 * O que fazer com o que já existe para esta `ref`, antes de montar o payload.
 *
 * `reservar` significa "nada terminal no caminho, siga" — a reserva atômica
 * decide de verdade quem emite.
 */
export type EmissaoDecisao = { kind: "reservar" } | ({ kind: "responder" } & EmissaoResposta);

function nomeDoModelo(model: FiscalModel): string {
  return model === "nfce" ? "NFC-e" : "NF-e";
}

/**
 * A recusa de emitir um modelo por cima de outro já autorizado para a mesma
 * origem — a NFC-e e a NF-e da mesma venda dividem a `ref`, e portanto a linha.
 */
function modeloDivergente(existing: EmissaoSnapshot, origem: string): EmissaoResposta {
  return {
    errors: [
      `Esta ${origem} já tem uma ${nomeDoModelo(existing.model)} ` +
        `autorizada (chave ${existing.chave ?? "—"}). Cancele-a antes de emitir outro modelo.`,
    ],
    extra: {},
  };
}

/**
 * A mensagem de quem chegou enquanto outra emissão da mesma venda está em voo.
 *
 * Não é erro do operador nem recusa da SEFAZ, e a mensagem precisa dizer isso —
 * senão o duplo clique vira um chamado de suporte. Ela sai por `errors`, que é
 * o único canal que a tela lê (`fiscalEmitApi.ts`), com `status` junto para
 * quem quiser tratar o caso especificamente.
 */
function emAndamento(origem: string): EmissaoResposta {
  return {
    errors: [
      `A emissão da nota desta ${origem} já está em andamento. ` +
        "Aguarde alguns segundos e atualize a tela para ver o resultado.",
    ],
    extra: { status: RESERVA_STATUS },
  };
}

/**
 * Estado terminal já gravado para esta `ref` — a idempotência que existe desde
 * A1, agora numa tabela só.
 *
 * Continua valendo o que `handleEmit` já fazia: nota autorizada não é
 * reemitida (devolve a chave que existe), nota autorizada em **outro modelo**
 * recusa com instrução de cancelar antes, e nota cancelada não volta atrás.
 * O que mudou é `processando_autorizacao` deixar de ser um estado impossível.
 */
export function decideEmissao(
  existing: EmissaoSnapshot | null,
  model: FiscalModel,
  origem: string,
): EmissaoDecisao {
  if (!existing) return { kind: "reservar" };

  if (existing.status === "autorizado") {
    if (existing.model !== model) {
      return { kind: "responder", ...modeloDivergente(existing, origem) };
    }
    return { kind: "responder", errors: [], extra: { chave: existing.chave, status: existing.status } };
  }

  if (existing.status === "cancelado") {
    return {
      kind: "responder",
      errors: [`A nota desta ${origem} já foi cancelada e não pode ser reemitida.`],
      extra: {},
    };
  }

  if (existing.status === RESERVA_STATUS) {
    return { kind: "responder", ...emAndamento(origem) };
  }

  // `erro_autorizacao` e `denegado`: reemitir é o caminho legítimo, e era o que
  // esta função já permitia antes de A5. A diferença é que agora quem reemite
  // precisa vencer a reserva atômica para chegar ao provedor.
  return { kind: "reservar" };
}

/**
 * O que responder para quem **perdeu** a corrida da reserva.
 *
 * Quem perdeu não chama o provedor — seria exatamente a segunda emissão que
 * esta tarefa existe para impedir. Ele lê de novo a linha e devolve o que o
 * vencedor conseguiu: a chave, se já terminou; a recusa da SEFAZ, se terminou
 * recusado; ou "em andamento", se ainda está emitindo.
 *
 * `current === null` é a linha ter sumido entre a reserva perdida e esta
 * leitura — o vencedor desfez a reserva dele porque a chamada ao provedor
 * falhou (ver `releaseEmission`). Não há desfecho para devolver, e pedir de
 * novo é a resposta certa.
 */
export function decideAposPerderCorrida(
  current: EmissaoSnapshot | null,
  model: FiscalModel,
  origem: string,
): EmissaoResposta {
  if (!current) {
    return {
      errors: [
        `Não foi possível emitir a nota desta ${origem} agora: outra tentativa em ` +
          "paralelo falhou antes de concluir. Tente novamente.",
      ],
      extra: {},
    };
  }

  if (current.status === "autorizado") {
    // Mesma checagem de modelo do caminho rápido, e pelo mesmo motivo: duas
    // requisições concorrentes podem pedir modelos diferentes para a mesma
    // venda (uma aba pedindo NF-e, outra NFC-e). Sem isto, quem pediu NF-e e
    // perdeu a corrida receberia `ok: true` com a chave de uma NFC-e — uma nota
    // que não é a que ele pediu.
    if (current.model !== model) return modeloDivergente(current, origem);
    return { errors: [], extra: { chave: current.chave, status: current.status } };
  }
  if (current.status === "cancelado") {
    return {
      errors: [`A nota desta ${origem} já foi cancelada e não pode ser reemitida.`],
      extra: { status: current.status },
    };
  }
  if (current.status === RESERVA_STATUS) {
    return emAndamento(origem);
  }

  // `erro_autorizacao` / `denegado`: o vencedor já tem o desfecho, e é o dele
  // que vale. Repetir a emissão aqui produziria a segunda nota que a reserva
  // acabou de evitar.
  return {
    errors: [current.mensagem_sefaz ?? "A SEFAZ recusou a emissão."],
    extra: { status: current.status },
  };
}

/**
 * "Outra requisição chegou primeiro" — visto pelo lado do erro do Postgres.
 *
 * `23505` é `unique_violation`, e o PostgREST repassa o `code` do Postgres
 * intacto. Em `fiscal_documents` só há três índices únicos que uma emissão
 * pode esbarrar — `ref`, `(sale_id, model)` e `(sale_return_id, model)` — e os
 * três significam a mesma coisa: já existe linha para este documento.
 *
 * ## Por que `insert` + `23505`, e não `on conflict (ref) do nothing`
 *
 * As duas construções são igualmente atômicas. A diferença é o que acontece
 * quando o conflito **não** é na `ref`: `on conflict (ref) do nothing` não
 * cobre os índices parciais por origem + modelo, e um conflito ali voltaria
 * como erro não tratado em vez de "perdi a corrida". Detectar pelo código do
 * erro trata os três de uma vez, e não depende de o PostgREST devolver lista
 * vazia num `DO NOTHING` — comportamento que é do Postgres, mas que passaria a
 * ser dependência de versão da biblioteca.
 */
export function isViolacaoDeUnicidade(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/* ------------------------------------------------------------------------ */
/* A resolução de uma reserva presa (A6, 09/09/2026)                         */
/* ------------------------------------------------------------------------ */

/**
 * **O que A5 garantia, e por que a garantia não é suficiente.**
 *
 * A5 fechou o invariante "`processando_autorizacao` não sobrevive à requisição
 * HTTP que o escreveu": todo caminho de saída de `handleEmit` depois da reserva
 * ou grava o desfecho ou chama `releaseEmission`. A leitura estava certa **sobre
 * o código**. O que ela pressupunha é que o código sempre chega ao fim.
 *
 * Ele não chega. A documentação da Supabase lista seis motivos de desligamento
 * de um worker de Edge Function — `EventLoopCompleted`, `WallClockTime`,
 * `CPUTime`, `Memory`, `EarlyDrop` e `TerminationRequested` (implantações e
 * atualizações) — e diz, sobre limpeza: *implemente, mas espere que ela possa
 * não rodar*. Quatro desses seis matam o isolate no meio da execução, e num
 * isolate morto o `catch` de `handleEmit` **não roda**: a linha fica em
 * `processando_autorizacao` para sempre, e `decideEmissao` recusa reemitir por
 * cima dela — a venda fica sem nota e sem saída.
 *
 * Os limites são 400s de relógio (150s no plano gratuito), 2s de CPU e 256MB de
 * memória por worker. Os dois últimos são alcançáveis por este código: além do
 * `buildPayload`, a emissão lê `ibpt_rates` e `mva_rules` **inteiras** (sem
 * `limit`, sem filtro — ver `data.ts`) e a coluna `numero` inteira da filial
 * (`readLastNumero`), e o provedor simulado ainda monta XML e DANFE em string.
 * `TerminationRequested` não depende de volume nenhum: basta implantar
 * `fiscal-emit` enquanto uma emissão está em voo.
 *
 * ## A regra: nunca liberar sem perguntar ao provedor
 *
 * Uma reserva velha **não** pode ser simplesmente devolvida para reemissão. Os
 * dois desfechos possíveis são indistinguíveis pelo banco:
 *
 * - o isolate morreu **antes** de o provedor emitir — não há nota, e liberar é
 *   o certo;
 * - o isolate morreu **depois** de o provedor emitir e antes de `persistEmission`
 *   gravar — a nota **existe** para a SEFAZ, e reemitir criaria uma segunda nota
 *   real para a mesma venda: exatamente o estrago que A5 existe para impedir,
 *   agora por um caminho novo.
 *
 * Quem sabe a diferença é o provedor. Por isso a resolução é sempre a mesma
 * sequência: **consultar a `ref`, e só então decidir**. `nao_encontrado` libera;
 * qualquer documento de verdade é gravado (a nota não estava perdida — só a
 * resposta da primeira chamada não chegou a ser gravada).
 *
 * ## Por que não há limite de tempo aqui
 *
 * A pergunta "a reserva tem mais de N minutos?" não aparece nesta tabela, e a
 * ausência é decisão, não esquecimento: **perguntar ao provedor é seguro em
 * qualquer idade da reserva**. A consulta não escreve nada por si; ela lê o que
 * o provedor sabe. Uma reserva de dois segundos consultada devolve
 * `processando_autorizacao` (ou o documento, se o provedor já terminou) e nada
 * é liberado — o limiar não protegeria de nada que a própria consulta já não
 * proteja.
 *
 * O limiar só serve para decidir **quando consultar sem um humano presente** —
 * e isso é agendamento, ou seja, A7. Ver a entrada de A6 no AGENTS.md para o
 * número que A7 vai querer (o limite de relógio da plataforma) e por que ele
 * deixa de valer quando A12 trouxer a emissão assíncrona de verdade.
 */

/**
 * O que o provedor respondeu, reduzido ao que a decisão precisa.
 *
 * `status` é `string` e não `FiscalStatus` pelo mesmo motivo de
 * `EmissaoSnapshot.status`: o valor atravessa o JSON do provedor, e a decisão
 * trata o desconhecido em vez de confiar no tipo.
 */
export type ConsultaSnapshot = {
  status: string;
  chave: string | null;
  mensagemSefaz: string | null;
};

/**
 * O que fazer com a linha depois de o provedor responder.
 *
 * - `gravar` — o provedor tem um documento de verdade; ele passa a ser o que a
 *   linha diz (`persistQueryStatus`).
 * - `liberar` — o provedor não tem nada para esta `ref` e a linha é uma reserva:
 *   nenhuma nota foi emitida, e a venda volta a poder emitir.
 * - `manter` — nada é escrito.
 */
export type ConsultaDecisao =
  | ({ kind: "gravar" } & EmissaoResposta)
  | ({ kind: "liberar"; mensagemSefaz: string } & EmissaoResposta)
  | ({ kind: "manter" } & EmissaoResposta);

/**
 * O texto gravado em `mensagem_sefaz` quando uma reserva órfã é liberada.
 *
 * A coluna se chama `mensagem_sefaz` e esta mensagem **não vem da SEFAZ** — ela
 * diz isso na primeira frase, de propósito. É o único canal de texto livre que a
 * tela lê (`InvoicesPage.tsx` mostra "Mensagem da SEFAZ"), e criar uma coluna
 * nova para uma frase custaria uma migration numa tabela fiscal; deixar a
 * mensagem antiga no lugar seria pior, porque ela descreveria uma tentativa que
 * não é a última.
 */
export const MENSAGEM_RESERVA_LIBERADA =
  "A emissão anterior não foi concluída pelo sistema (não é recusa da SEFAZ). " +
  "O provedor não tem registro desta nota, então nenhum documento foi emitido " +
  "e a venda pode ser emitida novamente.";

/**
 * O status para o qual uma reserva liberada vai.
 *
 * **Não é `delete`**, ao contrário do que `releaseEmission` faz no caminho de
 * erro da própria requisição. Lá a linha era sempre recém-criada e não tinha
 * filho nenhum; aqui a reserva pode ter sido tomada por cima de uma nota
 * recusada (o CAS de `reserveEmission`), e `fiscal_document_items` e
 * `fiscal_document_events` apontam para ela com `on delete cascade` — apagar a
 * linha apagaria junto o histórico de rejeições, que é justamente o que uma
 * auditoria fiscal vai procurar.
 *
 * `erro_autorizacao` é o estado que o enum já tem para "a emissão não deu
 * certo, tentar de novo é legítimo", e é o que `decideEmissao` já aceita
 * reemitir. `denegado` estaria errado: denegação é ato da SEFAZ contra a
 * situação fiscal do emitente ou do destinatário, e nada disso aconteceu aqui.
 */
export const STATUS_APOS_LIBERAR = "erro_autorizacao";

/**
 * A tabela de transições da consulta.
 *
 * Linhas = o que o banco diz hoje; colunas = o que o provedor respondeu. A
 * versão legível está no AGENTS.md (entrada de A6); aqui está a que roda.
 *
 * Três regras, nesta ordem:
 *
 * 1. **`cancelado` é terminal e nada o desfaz.** Um cancelamento é evento nosso,
 *    registrado em `fiscal_document_events` e mostrado na tela; um provedor que
 *    responda `autorizado` por atraso de propagação não pode ressuscitar a nota.
 *    É a única transição que A6 fecha de propósito — antes desta tarefa,
 *    `persistQueryStatus` escrevia o que viesse, sem olhar o que havia.
 * 2. **`nao_encontrado` sobre uma reserva libera; sobre qualquer outro estado,
 *    não escreve nada.** Um provedor que não conhece uma nota que o banco diz
 *    `autorizado` é divergência para o operador investigar, nunca motivo para
 *    apagar uma chave de acesso.
 * 3. **`processando_autorizacao` vindo do provedor não é gravado.** É o estado
 *    normal da emissão assíncrona (A12), e escrevê-lo por cima da linha faria
 *    `persistQueryStatus` zerar `chave`, `numero` e `protocolo` com os nulos da
 *    consulta. Não há o que atualizar: a resposta é "ainda não terminou".
 *
 * O resto (`autorizado`, `erro_autorizacao`, `denegado`, `cancelado` vindos do
 * provedor) é gravado — é o desfecho que a primeira chamada não conseguiu
 * gravar, e é por aqui que `denegado` finalmente passa a ser escrito.
 */
export function decideConsulta(
  existing: EmissaoSnapshot,
  consultado: ConsultaSnapshot,
  origem: string,
): ConsultaDecisao {
  if (existing.status === "cancelado" && consultado.status !== "cancelado") {
    return {
      kind: "manter",
      errors: [
        `A nota desta ${origem} está cancelada aqui, mas o provedor responde ` +
          `"${consultado.status}". Nada foi alterado — confira no portal do provedor antes de agir.`,
      ],
      extra: { status: existing.status },
    };
  }

  if (consultado.status === "nao_encontrado") {
    if (existing.status === RESERVA_STATUS) {
      return {
        kind: "liberar",
        mensagemSefaz: MENSAGEM_RESERVA_LIBERADA,
        errors: [],
        extra: { status: STATUS_APOS_LIBERAR, mensagem: MENSAGEM_RESERVA_LIBERADA },
      };
    }
    // O que `handleQuery` já respondia desde A1, agora com o motivo escrito: o
    // banco sabe mais que o provedor neste caso, e sobrescrever apagaria a
    // chave de uma nota que existe.
    return {
      kind: "manter",
      errors: ["O provedor não conhece esta nota."],
      extra: { status: existing.status },
    };
  }

  if (consultado.status === RESERVA_STATUS) {
    return {
      kind: "manter",
      errors: [],
      extra: {
        status: existing.status,
        mensagem:
          "A emissão ainda está em processamento no provedor. Consulte de novo em alguns instantes.",
      },
    };
  }

  if (consultado.status === "autorizado") {
    return {
      kind: "gravar",
      errors: [],
      extra: {
        status: consultado.status,
        chave: consultado.chave,
        mensagem: "O provedor confirmou a autorização desta nota.",
      },
    };
  }

  if (consultado.status === "cancelado") {
    return {
      kind: "gravar",
      errors: [],
      extra: { status: consultado.status, mensagem: "O provedor informa que esta nota está cancelada." },
    };
  }

  // `erro_autorizacao` e `denegado`: recusa é resultado de negócio, e sai pelo
  // mesmo canal que `handleEmit` usa para uma recusa na hora da emissão.
  return {
    kind: "gravar",
    errors: [consultado.mensagemSefaz ?? "A SEFAZ recusou a emissão."],
    extra: { status: consultado.status },
  };
}
