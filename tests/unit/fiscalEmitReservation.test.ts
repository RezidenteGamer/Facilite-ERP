import { describe, expect, it } from "vitest";

import { createSimulatedFiscalProvider } from "@fiscal-core/simulatedFiscalProvider.ts";
import type { NfePayload } from "@fiscal-core/types.ts";

import {
  RESERVA_STATUS,
  decideAposPerderCorrida,
  decideEmissao,
  isViolacaoDeUnicidade,
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
 * Uma instância do simulado como `handleEmit` a constrói: nova a cada
 * requisição (`createProvider`), com a numeração restaurada do banco
 * (`readLastNumero`) e nada mais.
 *
 * O `randomInt` é injetado com valores diferentes nas duas instâncias porque é
 * assim que dois processos independentes se comportam — o sorteio do `cNF` e do
 * protocolo não é coordenado entre eles. Injetar deixa o teste determinístico
 * em vez de depender de duas chamadas a `Math.random` não colidirem.
 */
function provedorDeUmaRequisicao(ultimoNumero: number, semente: number) {
  return createSimulatedFiscalProvider({
    now: () => new Date("2026-09-07T12:00:00-03:00"),
    randomInt: (max) => semente % max,
    seed: { lastNumbers: [{ cnpj: CNPJ, model: "nfe", ultimoNumero }] },
  });
}

describe("a corrida de emissão que A5 fecha", () => {
  it("duas requisições concorrentes emitem duas notas diferentes para a mesma ref", async () => {
    // As duas leram o banco antes de qualquer uma escrever: mesma `ref`, mesma
    // ausência de nota, mesmo `readLastNumero`.
    const ref = "venda-11111111-1111-1111-1111-111111111111";
    const ultimoNumeroLidoPelasDuas = 41;

    const [primeira, segunda] = await Promise.all([
      provedorDeUmaRequisicao(ultimoNumeroLidoPelasDuas, 12_345_678).emit({
        ref,
        model: "nfe",
        payload: payload(),
      }),
      provedorDeUmaRequisicao(ultimoNumeroLidoPelasDuas, 87_654_321).emit({
        ref,
        model: "nfe",
        payload: payload(),
      }),
    ]);

    // O `Map` de `documents` que faz a idempotência dentro de `emit()` nasce
    // vazio nas duas instâncias — ele não coordena nada entre requisições.
    expect(primeira.status).toBe("autorizado");
    expect(segunda.status).toBe("autorizado");

    // Mesmo número (as duas continuaram de 41) e chaves diferentes: são duas
    // notas distintas para a mesma venda. O `upsert` por `ref` de
    // `persistEmission` guarda só uma das duas — a última a gravar.
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
