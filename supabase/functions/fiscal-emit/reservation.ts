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
