import { describe, expect, it } from "vitest";

import {
  SERIE_SIMULADA,
  createSimulatedFiscalProvider,
} from "@fiscal-core/simulatedFiscalProvider.ts";
import type { NfePayload } from "@fiscal-core/types.ts";

import {
  MENSAGEM_RESERVA_LIBERADA,
  RESERVA_STATUS,
  STATUS_APOS_LIBERAR,
  decideAposPerderCorrida,
  decideConsulta,
  decideEmissao,
  isViolacaoDeUnicidade,
  type ConsultaSnapshot,
  type EmissaoSnapshot,
} from "../../supabase/functions/fiscal-emit/reservation.ts";

/**
 * A5 (07/09/2026) — a metade da trava de emissão que cabe num teste sem rede.
 *
 * Duas coisas moram aqui:
 *
 * 1. **A prova do estrago.** O primeiro `describe` mostra, sem banco e sem
 *    HTTP, o que duas emissões concorrentes da mesma venda produziam antes da
 *    reserva: dois documentos com **chaves de acesso diferentes** para a mesma
 *    `ref`. Como `persistEmission` faz `upsert(..., { onConflict: "ref" })`, o
 *    segundo a gravar apagava a chave do primeiro.
 * 2. **A tabela de decisão da reserva** (`reservation.ts`): o que responder para
 *    cada estado que a linha pode ter, antes e depois de perder a corrida.
 *
 * O que **não** cabe aqui é a atomicidade em si — ela é do Postgres, e quem a
 * exercita é `tests/concurrency/fiscalEmitConcurrency.test.ts`, contra o
 * Supabase real.
 *
 * O import de `reservation.ts` é relativo, e não pelo alias `@fiscal-core`:
 * aquele alias aponta para o núcleo compartilhado entre o front e a Edge
 * Function, e este arquivo é da Edge Function. Ele foi escrito sem nenhum
 * import de runtime (só tipos) justamente para poder ser lido daqui — os
 * outros três arquivos de `fiscal-emit/` trazem `jsr:@supabase/supabase-js@2`
 * junto e não são importáveis fora do Deno.
 */

/* ------------------------------------------------------------------------ */
/* 1. A corrida, vista do provedor                                           */
/* ------------------------------------------------------------------------ */

const CNPJ = "00.000.000/0001-91";

function payload(): NfePayload {
  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: "2026-09-07T12:00:00-03:00",
    tipo_documento: 1,
    finalidade_emissao: 1,
    cnpj_emitente: CNPJ,
    nome_emitente: "Facilite Testes LTDA",
    uf_emitente: "SP",
    valor_produtos: 10,
    valor_total: 10,
    items: [
      {
        numero_item: 1,
        codigo_produto: "001",
        descricao: "Produto de teste",
        cfop: "5102",
        codigo_ncm: "19059090",
        quantidade_comercial: 1,
        valor_unitario_comercial: 10,
        valor_bruto: 10,
        icms_origem: "0",
        icms_situacao_tributaria: "00",
      },
    ],
  };
}

/**
 * Uma instância do simulado como `handleEmit` a construía **antes de A5**: nova
 * a cada requisição (`createProvider`), com a numeração vinda do banco e nada
 * mais.
 *
 * O `numero` é passado **igual nas duas** de propósito: era exatamente o que
 * `readLastNumero` produzia até A10 (09/09/2026) — um `select max()` sem trava,
 * lido igual pelas duas requisições concorrentes. Depois de A10 a borda aloca o
 * número atomicamente (`fiscal_numbering_next`) e nunca entrega o mesmo a duas
 * emissões; aqui ele é fixado à mão para reproduzir o mundo que A5 tinha de
 * consertar, que é o que este bloco existe para demonstrar.
 *
 * O `randomInt` é injetado com valores diferentes nas duas instâncias porque é
 * assim que dois processos independentes se comportam — o sorteio do `cNF` e do
 * protocolo não é coordenado entre eles. Injetar deixa o teste determinístico
 * em vez de depender de duas chamadas a `Math.random` não colidirem.
 */
function provedorDeUmaRequisicao(numero: number, semente: number) {
  return createSimulatedFiscalProvider({
    now: () => new Date("2026-09-07T12:00:00-03:00"),
    randomInt: (max) => semente % max,
    seed: { numeros: [{ cnpj: CNPJ, model: "nfe", serie: SERIE_SIMULADA, numero }] },
  });
}

describe("a corrida de emissão que A5 fecha", () => {
  it("duas requisições concorrentes emitem duas notas diferentes para a mesma ref", async () => {
    // As duas leram o banco antes de qualquer uma escrever: mesma `ref`, mesma
    // ausência de nota, mesmo número (o `readLastNumero` de então).
    const ref = "venda-11111111-1111-1111-1111-111111111111";
    const numeroQueAsDuasRecebiam = 42;

    const [primeira, segunda] = await Promise.all([
      provedorDeUmaRequisicao(numeroQueAsDuasRecebiam, 12_345_678).emit({
        ref,
        model: "nfe",
        payload: payload(),
      }),
      provedorDeUmaRequisicao(numeroQueAsDuasRecebiam, 87_654_321).emit({
        ref,
        model: "nfe",
        payload: payload(),
      }),
    ]);

    // O `Map` de `documents` que faz a idempotência dentro de `emit()` nasce
    // vazio nas duas instâncias — ele não coordena nada entre requisições.
    expect(primeira.status).toBe("autorizado");
    expect(segunda.status).toBe("autorizado");

    // Mesmo número e chaves diferentes: são duas notas distintas para a mesma
    // venda. O `upsert` por `ref` de `persistEmission` guarda só uma das duas —
    // a última a gravar.
    expect(segunda.numero).toBe(primeira.numero);
    expect(segunda.chave).not.toBe(primeira.chave);
  });
});

/* ------------------------------------------------------------------------ */
/* 2. A tabela de decisão                                                    */
/* ------------------------------------------------------------------------ */

function snapshot(overrides: Partial<EmissaoSnapshot> = {}): EmissaoSnapshot {
  return {
    status: "autorizado",
    model: "nfe",
    chave: "35260900000000000191550010000000421000000420",
    mensagem_sefaz: null,
    ...overrides,
  };
}

describe("decideEmissao — o que fazer com o que já existe para esta ref", () => {
  it("sem nota nenhuma, reserva", () => {
    expect(decideEmissao(null, "nfe", "venda")).toEqual({ kind: "reservar" });
  });

  it("nota autorizada no mesmo modelo devolve a chave sem reemitir", () => {
    const decisao = decideEmissao(snapshot(), "nfe", "venda");
    expect(decisao).toEqual({
      kind: "responder",
      errors: [],
      extra: { chave: snapshot().chave, status: "autorizado" },
    });
  });

  it("nota autorizada em outro modelo recusa e manda cancelar antes", () => {
    const decisao = decideEmissao(snapshot({ model: "nfce" }), "nfe", "venda");
    expect(decisao.kind).toBe("responder");
    if (decisao.kind !== "responder") throw new Error("inalcançável");
    expect(decisao.errors[0]).toContain("já tem uma NFC-e");
    expect(decisao.errors[0]).toContain("Cancele-a antes");
  });

  it("nota cancelada não volta atrás", () => {
    const decisao = decideEmissao(snapshot({ status: "cancelado" }), "nfe", "venda");
    expect(decisao.kind).toBe("responder");
    if (decisao.kind !== "responder") throw new Error("inalcançável");
    expect(decisao.errors[0]).toContain("já foi cancelada");
  });

  it("emissão em andamento recusa em vez de emitir uma segunda nota", () => {
    const decisao = decideEmissao(snapshot({ status: RESERVA_STATUS, chave: null }), "nfe", "venda");
    expect(decisao.kind).toBe("responder");
    if (decisao.kind !== "responder") throw new Error("inalcançável");
    expect(decisao.errors[0]).toContain("já está em andamento");
    expect(decisao.extra).toEqual({ status: RESERVA_STATUS });
  });

  it("nota recusada pela SEFAZ pode ser reemitida — mas passando pela reserva", () => {
    for (const status of ["erro_autorizacao", "denegado"]) {
      expect(decideEmissao(snapshot({ status, chave: null }), "nfe", "venda")).toEqual({
        kind: "reservar",
      });
    }
  });
});

describe("decideAposPerderCorrida — o que responder para quem não reservou", () => {
  it("o vencedor já autorizou: devolve a chave dele, sem emitir de novo", () => {
    expect(decideAposPerderCorrida(snapshot(), "nfe", "venda")).toEqual({
      errors: [],
      extra: { chave: snapshot().chave, status: "autorizado" },
    });
  });

  it("o vencedor ainda está emitindo: responde que está em andamento", () => {
    const resposta = decideAposPerderCorrida(
      snapshot({ status: RESERVA_STATUS, chave: null }),
      "nfe",
      "venda",
    );
    expect(resposta.errors[0]).toContain("já está em andamento");
    expect(resposta.extra).toEqual({ status: RESERVA_STATUS });
  });

  it("o vencedor foi recusado: repassa a mensagem da SEFAZ, sem tentar de novo", () => {
    const resposta = decideAposPerderCorrida(
      snapshot({ status: "erro_autorizacao", chave: null, mensagem_sefaz: "Rejeição: NCM inválido" }),
      "nfe",
      "venda",
    );
    expect(resposta).toEqual({
      errors: ["Rejeição: NCM inválido"],
      extra: { status: "erro_autorizacao" },
    });
  });

  it("o vencedor foi recusado sem mensagem: ainda assim não reemite", () => {
    const resposta = decideAposPerderCorrida(
      snapshot({ status: "erro_autorizacao", chave: null }),
      "nfe",
      "venda",
    );
    expect(resposta.errors).toEqual(["A SEFAZ recusou a emissão."]);
  });

  it("a linha sumiu (o vencedor desfez a reserva): pede para tentar de novo", () => {
    const resposta = decideAposPerderCorrida(null, "nfe", "devolução");
    expect(resposta.errors[0]).toContain("devolução");
    expect(resposta.errors[0]).toContain("Tente novamente");
    expect(resposta.extra).toEqual({});
  });

  it("o vencedor autorizou outro modelo: recusa em vez de devolver a chave errada", () => {
    // Duas abas pedindo a mesma venda, uma em NF-e e outra em NFC-e: a `ref` é
    // a mesma, então a linha é a mesma. Quem perdeu não pode receber `ok: true`
    // com a chave de uma nota que não é a que pediu.
    const resposta = decideAposPerderCorrida(snapshot({ model: "nfce" }), "nfe", "venda");
    expect(resposta.errors[0]).toContain("já tem uma NFC-e");
    expect(resposta.extra).toEqual({});
  });

  it("o vencedor cancelou no meio: não reemite por cima de nota cancelada", () => {
    const resposta = decideAposPerderCorrida(snapshot({ status: "cancelado" }), "nfe", "venda");
    expect(resposta.errors[0]).toContain("já foi cancelada");
  });
});

describe("isViolacaoDeUnicidade — 'outra requisição chegou primeiro'", () => {
  it("reconhece o 23505 do Postgres, que é o que o PostgREST repassa", () => {
    expect(isViolacaoDeUnicidade({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  it("não confunde outro erro do banco com perda de corrida", () => {
    // Se `23503` (violação de chave estrangeira) ou `42501` (permissão) fossem
    // lidos como corrida, a emissão responderia "já está em andamento" para uma
    // falha que ninguém veria — e o operador ficaria esperando uma nota que
    // nunca vai sair.
    expect(isViolacaoDeUnicidade({ code: "23503" })).toBe(false);
    expect(isViolacaoDeUnicidade({ code: "42501" })).toBe(false);
    expect(isViolacaoDeUnicidade(new Error("duplicate key value"))).toBe(false);
    expect(isViolacaoDeUnicidade(null)).toBe(false);
    expect(isViolacaoDeUnicidade(undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* 3. A resolução de uma reserva presa (A6, 09/09/2026)                      */
/* ------------------------------------------------------------------------ */

/**
 * `decideConsulta` é a metade de A6 que cabe num teste sem rede: dado o que o
 * banco diz e o que o provedor respondeu, o que escrever.
 *
 * O que **não** cabe aqui é a atomicidade do compare-and-swap de
 * `releaseStuckReservation` — ela é do Postgres, pelo mesmo motivo que a
 * reserva de A5 não é testada aqui.
 *
 * A regra que estes testes existem para proteger é uma só, e é a mais cara de
 * errar no sistema inteiro: **nunca liberar uma reserva sem o provedor ter dito
 * que não conhece a `ref`**. Liberar por idade, ou liberar quando o provedor
 * respondeu qualquer outra coisa, produziria uma segunda nota fiscal real para
 * a mesma venda.
 */
function consulta(over: Partial<ConsultaSnapshot> = {}): ConsultaSnapshot {
  return { status: "autorizado", chave: "3526".padEnd(44, "0"), mensagemSefaz: null, ...over };
}

describe("decideConsulta — o provedor decide, não o relógio", () => {
  const reserva = (): EmissaoSnapshot => snapshot({ status: RESERVA_STATUS, chave: null });

  it("reserva + o provedor não conhece a ref: libera para nova emissão", () => {
    const decisao = decideConsulta(reserva(), consulta({ status: "nao_encontrado", chave: null }), "venda");
    expect(decisao.kind).toBe("liberar");
    expect(decisao.errors).toEqual([]);
    expect(decisao.extra.status).toBe(STATUS_APOS_LIBERAR);
    // A mensagem gravada precisa dizer que não é recusa da SEFAZ — ela vai para
    // a coluna `mensagem_sefaz`, que a tela rotula como "Mensagem da SEFAZ".
    expect(MENSAGEM_RESERVA_LIBERADA).toContain("não é recusa da SEFAZ");
  });

  it("reserva + o provedor já autorizou: grava a nota em vez de liberar", () => {
    // O caso caro: o `emit()` terminou do lado do provedor e o isolate morreu
    // antes de `persistEmission` gravar. A nota existe para a SEFAZ. Liberar
    // aqui faria a próxima emissão criar uma segunda nota real para a mesma
    // venda — exatamente o estrago que A5 existe para impedir.
    const decisao = decideConsulta(reserva(), consulta({ chave: "35260000000001" }), "venda");
    expect(decisao.kind).toBe("gravar");
    expect(decisao.errors).toEqual([]);
    expect(decisao.extra).toMatchObject({ status: "autorizado", chave: "35260000000001" });
  });

  it("reserva + o provedor recusou: grava a recusa e devolve a mensagem dele", () => {
    const decisao = decideConsulta(
      reserva(),
      consulta({ status: "erro_autorizacao", chave: null, mensagemSefaz: "Rejeição 539: duplicidade" }),
      "venda",
    );
    expect(decisao.kind).toBe("gravar");
    expect(decisao.errors).toEqual(["Rejeição 539: duplicidade"]);
    expect(decisao.extra).toEqual({ status: "erro_autorizacao" });
  });

  it("reserva + denegado: grava — é por aqui que o estado deixa de ser inalcançável", () => {
    // `denegado` está no enum desde A3 e nunca foi escrito por caminho nenhum.
    // A consulta é o primeiro que o escreve.
    const decisao = decideConsulta(
      reserva(),
      consulta({ status: "denegado", chave: null, mensagemSefaz: "Rejeição 302: IE do destinatário irregular" }),
      "venda",
    );
    expect(decisao.kind).toBe("gravar");
    expect(decisao.extra).toEqual({ status: "denegado" });
  });

  it("reserva + o provedor ainda está processando: não escreve nada e pede paciência", () => {
    // O estado normal da emissão assíncrona (A12). Gravar aqui não teria o que
    // atualizar, e `persistQueryStatus` zeraria chave, número e protocolo com
    // os nulos da consulta.
    const decisao = decideConsulta(
      reserva(),
      consulta({ status: RESERVA_STATUS, chave: null }),
      "venda",
    );
    expect(decisao.kind).toBe("manter");
    expect(decisao.errors).toEqual([]);
    expect(decisao.extra.status).toBe(RESERVA_STATUS);
    expect(String(decisao.extra.mensagem)).toContain("ainda está em processamento");
  });

  it("nota autorizada + o provedor não a conhece: divergência, e nada é apagado", () => {
    // Sobrescrever aqui apagaria a chave de acesso de uma nota que existe. É a
    // perda que A5 inteira existe para impedir, por um caminho novo.
    const decisao = decideConsulta(
      snapshot({ status: "autorizado" }),
      consulta({ status: "nao_encontrado", chave: null }),
      "venda",
    );
    expect(decisao.kind).toBe("manter");
    expect(decisao.errors).toEqual(["O provedor não conhece esta nota."]);
    expect(decisao.extra).toEqual({ status: "autorizado" });
  });

  it("nota recusada + o provedor não a conhece: também não libera", () => {
    // `erro_autorizacao` já é reemitível por `decideEmissao` — não há reserva
    // presa para soltar, e mexer na linha só apagaria a mensagem da recusa.
    const decisao = decideConsulta(
      snapshot({ status: "erro_autorizacao", chave: null }),
      consulta({ status: "nao_encontrado", chave: null }),
      "venda",
    );
    expect(decisao.kind).toBe("manter");
    expect(decisao.extra).toEqual({ status: "erro_autorizacao" });
  });

  it("nota cancelada + o provedor diz autorizado: o cancelamento não é desfeito", () => {
    // A única transição que A6 fecha de propósito. Antes desta tarefa,
    // `persistQueryStatus` escrevia o que viesse — um provedor atrasado
    // ressuscitaria uma nota que a empresa já cancelou.
    const decisao = decideConsulta(snapshot({ status: "cancelado" }), consulta(), "venda");
    expect(decisao.kind).toBe("manter");
    expect(decisao.extra).toEqual({ status: "cancelado" });
    expect(decisao.errors[0]).toContain("está cancelada aqui");
    expect(decisao.errors[0]).toContain("autorizado");
  });

  it("nota cancelada + o provedor concorda: grava, porque não há divergência", () => {
    const decisao = decideConsulta(
      snapshot({ status: "cancelado" }),
      consulta({ status: "cancelado" }),
      "venda",
    );
    expect(decisao.kind).toBe("gravar");
    expect(decisao.errors).toEqual([]);
  });

  it("nenhum estado do provedor libera a reserva, exceto nao_encontrado", () => {
    // A asserção que resume a tarefa: varrer o vocabulário inteiro de
    // `FiscalStatus` e conferir que só um valor produz `liberar`.
    const todos = [
      "autorizado",
      "cancelado",
      "erro_autorizacao",
      "denegado",
      RESERVA_STATUS,
      "nao_encontrado",
    ];
    const liberam = todos.filter(
      (status) => decideConsulta(reserva(), consulta({ status, chave: null }), "venda").kind === "liberar",
    );
    expect(liberam).toEqual(["nao_encontrado"]);
  });

  it("a origem entra na mensagem da divergência de cancelamento", () => {
    const decisao = decideConsulta(snapshot({ status: "cancelado" }), consulta(), "devolução");
    expect(decisao.errors[0]).toContain("devolução");
  });
});
