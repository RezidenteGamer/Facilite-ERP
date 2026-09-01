import { describe, expect, it } from "vitest";

import { createFocusProvider } from "@fiscal-core/focusProvider.ts";
import { FiscalNotConfiguredError } from "@fiscal-core/provider.ts";
import {
  DEFAULT_FISCAL_PROVIDER_ID,
  createFiscalProvider,
  isFiscalProviderId,
  resolveFiscalProviderId,
} from "@fiscal-core/registry.ts";
import {
  createSimulatedFiscalProvider,
  isValidAccessKey,
} from "@fiscal-core/simulatedFiscalProvider.ts";
import type { NfePayload } from "@fiscal-core/types.ts";

/**
 * Bateria do contrato `FiscalProvider` depois de A2 (01/09/2026), quando ele
 * passou de 3 para 7 métodos e o núcleo saiu de `src/lib/fiscal/` para
 * `supabase/functions/_shared/fiscal/`.
 *
 * Herda o papel de `scripts/fiscal-cycle-check.mjs`, que provava o ciclo
 * emit → query → cancel → query — mas **sem banco e sem login**: o simulado não
 * faz I/O, então isto roda em `npm test` e quebra o build, em vez de depender de
 * alguém lembrar de rodar um script. O script continua existindo porque ele
 * exercita o mapeamento a partir de uma venda real; o que é do provedor mora
 * aqui.
 */

const CNPJ = "00.000.000/0001-91";

function payload(overrides: Partial<NfePayload> = {}): NfePayload {
  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: "2026-09-01T12:00:00-03:00",
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
    ...overrides,
  };
}

/** Provedor determinístico: chave e protocolo previsíveis entre execuções. */
function provider(serie = 1) {
  return createSimulatedFiscalProvider({
    now: () => new Date("2026-09-01T15:00:00Z"),
    randomInt: () => 7,
    serie,
  });
}

const JUSTIFICATIVA = "Cancelamento por erro de digitacao no pedido";
const CORRECAO = "Correcao do nome do transportador informado na nota";

describe("SimulatedFiscalProvider — os três métodos originais", () => {
  it("autoriza uma emissão válida com chave de 44 dígitos e DV correto", async () => {
    const fiscal = provider();
    const document = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    expect(document.status).toBe("autorizado");
    expect(document.chave).not.toBeNull();
    expect(isValidAccessKey(document.chave!)).toBe(true);
    expect(document.xml?.content).toContain("<chNFe>");
    expect(document.pdf?.contentType).toBe("text/html");
  });

  it("não vaza o estado interno do provedor no documento devolvido", async () => {
    const fiscal = provider();
    const document = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    // `protocoloNumerico` e `cartasCorrecao` existem no registro interno e não
    // no contrato — ver `toDocument` em simulatedFiscalProvider.ts.
    expect(Object.keys(document)).not.toContain("protocoloNumerico");
    expect(Object.keys(document)).not.toContain("cartasCorrecao");
    expect(Object.keys(document)).not.toContain("cnpjEmitente");
  });

  it("recusa payload incompleto como resultado de negócio, sem lançar", async () => {
    const fiscal = provider();
    const semNcm = payload({ items: [{ ...payload().items[0], codigo_ncm: "" }] });
    const document = await fiscal.emit({ ref: "venda-2", model: "nfe", payload: semNcm });

    expect(document.status).toBe("erro_autorizacao");
    expect(document.mensagemSefaz).toContain("NCM ausente");
    expect(document.chave).toBeNull();
  });

  it("é idempotente por ref e responde nao_encontrado para ref desconhecida", async () => {
    const fiscal = provider();
    const primeira = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });
    const segunda = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    expect(segunda.chave).toBe(primeira.chave);
    expect((await fiscal.query("venda-1")).status).toBe("autorizado");
    expect((await fiscal.query("nao-existe")).status).toBe("nao_encontrado");
  });

  it("cancela com justificativa válida e recusa a segunda tentativa", async () => {
    const fiscal = provider();
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    const curta = await fiscal.cancel({ ref: "venda-1", justificativa: "curta" });
    expect(curta.status).toBe("erro_cancelamento");

    const ok = await fiscal.cancel({ ref: "venda-1", justificativa: JUSTIFICATIVA });
    expect(ok.status).toBe("cancelado");
    expect(ok.xmlCancelamento?.content).toContain("<tpEvento>110111</tpEvento>");

    const duplicado = await fiscal.cancel({ ref: "venda-1", justificativa: JUSTIFICATIVA });
    expect(duplicado.status).toBe("erro_cancelamento");
    expect(duplicado.statusSefaz).toBe("573");
  });
});

describe("SimulatedFiscalProvider — carta de correção (A2)", () => {
  it("registra a CC-e numerando a sequência e mantendo o documento autorizado", async () => {
    const fiscal = provider();
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    const primeira = await fiscal.correctionLetter({ ref: "venda-1", correcao: CORRECAO });
    expect(primeira.status).toBe("registrado");
    expect(primeira.numeroSequencial).toBe(1);
    expect(primeira.xml?.content).toContain("<tpEvento>110110</tpEvento>");

    const segunda = await fiscal.correctionLetter({ ref: "venda-1", correcao: CORRECAO });
    expect(segunda.numeroSequencial).toBe(2);

    // Corrigir não cancela: o documento continua valendo.
    expect((await fiscal.query("venda-1")).status).toBe("autorizado");
  });

  it("recusa texto fora de 15–1000 caracteres, ref desconhecida e nota cancelada", async () => {
    const fiscal = provider();
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    expect((await fiscal.correctionLetter({ ref: "venda-1", correcao: "curta" })).status).toBe(
      "erro_evento",
    );
    expect((await fiscal.correctionLetter({ ref: "nao-existe", correcao: CORRECAO })).status).toBe(
      "nao_encontrado",
    );

    await fiscal.cancel({ ref: "venda-1", justificativa: JUSTIFICATIVA });
    const depoisDoCancelamento = await fiscal.correctionLetter({ ref: "venda-1", correcao: CORRECAO });
    expect(depoisDoCancelamento.status).toBe("erro_evento");
    expect(depoisDoCancelamento.statusSefaz).toBe("501");
  });

  it("para na vigésima carta, que é o limite da SEFAZ", async () => {
    const fiscal = provider();
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    for (let i = 0; i < 20; i += 1) {
      const resultado = await fiscal.correctionLetter({ ref: "venda-1", correcao: CORRECAO });
      expect(resultado.status).toBe("registrado");
      expect(resultado.numeroSequencial).toBe(i + 1);
    }

    const excedente = await fiscal.correctionLetter({ ref: "venda-1", correcao: CORRECAO });
    expect(excedente.status).toBe("erro_evento");
    expect(excedente.statusSefaz).toBe("594");
  });
});

describe("SimulatedFiscalProvider — inutilização de faixa (A2)", () => {
  const faixa = {
    ref: "inut-1",
    cnpj: CNPJ,
    model: "nfe" as const,
    serie: 1,
    numeroInicial: 10,
    numeroFinal: 20,
    justificativa: "Numeracao perdida por falha na emissao",
  };

  it("registra a faixa, é idempotente por ref e recusa faixa sobreposta", async () => {
    const fiscal = provider();

    const registro = await fiscal.invalidateRange(faixa);
    expect(registro.status).toBe("registrado");
    expect(registro.statusSefaz).toBe("102");
    expect(registro.numeroSequencial).toBeNull();
    expect(registro.xml?.content).toContain("<nNFIni>10</nNFIni>");

    const repetido = await fiscal.invalidateRange(faixa);
    expect(repetido.protocolo).toBe(registro.protocolo);

    const sobreposto = await fiscal.invalidateRange({ ...faixa, ref: "inut-2", numeroInicial: 15, numeroFinal: 25 });
    expect(sobreposto.status).toBe("erro_evento");
    expect(sobreposto.statusSefaz).toBe("563");
  });

  it("respeita a série do pedido, não a série em que o provedor emite", async () => {
    const fiscal = provider(1);

    await fiscal.invalidateRange({ ...faixa, serie: 2 });
    // A faixa 10–20 foi inutilizada na série 2. Pedir a MESMA faixa na série 1
    // tem de passar: são numerações independentes. Antes da correção da revisão
    // desta tarefa, a série do pedido era ignorada e este pedido caía em 563.
    const serie1 = await fiscal.invalidateRange({ ...faixa, ref: "inut-serie-1", serie: 1 });
    expect(serie1.status).toBe("registrado");
    expect(serie1.xml?.content).toContain("<serie>1</serie>");
  });

  it("recusa justificativa curta e faixa invertida", async () => {
    const fiscal = provider();

    expect((await fiscal.invalidateRange({ ...faixa, justificativa: "curta" })).status).toBe(
      "erro_evento",
    );
    expect(
      (await fiscal.invalidateRange({ ...faixa, ref: "inut-3", numeroInicial: 30, numeroFinal: 20 }))
        .status,
    ).toBe("erro_evento");
  });

  it("recusa inutilizar número que já virou nota", async () => {
    const fiscal = provider();
    // A primeira emissão consome o número 1 da série 1.
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    const resultado = await fiscal.invalidateRange({ ...faixa, numeroInicial: 1, numeroFinal: 5 });
    expect(resultado.status).toBe("erro_evento");
    expect(resultado.mensagemSefaz).toContain("já utilizado");
  });

  it("faz a numeração seguinte pular a faixa inutilizada", async () => {
    const fiscal = provider();
    await fiscal.invalidateRange({ ...faixa, numeroInicial: 1, numeroFinal: 4 });

    const document = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });
    expect(document.numero).toBe("5");
  });
});

describe("SimulatedFiscalProvider — getXml / getDanfe (A2)", () => {
  it("devolve os artefatos da nota emitida", async () => {
    const fiscal = provider();
    await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });

    expect((await fiscal.getXml("venda-1"))?.contentType).toBe("application/xml");
    expect((await fiscal.getDanfe("venda-1"))?.contentType).toBe("text/html");
  });

  it("devolve null (e não exceção) quando não há artefato para a referência", async () => {
    const fiscal = provider();
    const recusada = payload({ items: [{ ...payload().items[0], cfop: "" }] });
    await fiscal.emit({ ref: "venda-recusada", model: "nfe", payload: recusada });

    expect(await fiscal.getXml("nao-existe")).toBeNull();
    expect(await fiscal.getXml("venda-recusada")).toBeNull();
    expect(await fiscal.getDanfe("venda-recusada")).toBeNull();
  });
});

describe("SimulatedFiscalProvider — seed do estado pela borda (A1)", () => {
  /**
   * A Edge Function `fiscal-emit` não mantém a instância viva entre duas
   * requisições: cada chamada pode cair num isolate novo. Sem restaurar o
   * estado, cancelar uma nota emitida ontem responderia `nao_encontrado` para
   * um documento que está `autorizado` no banco — que é o bug que estes testes
   * existem para impedir de voltar.
   */
  async function emitidaEm(instancia: ReturnType<typeof provider>) {
    return await instancia.emit({ ref: "venda-1", model: "nfe", payload: payload() });
  }

  it("cancela uma nota que esta instância nunca emitiu", async () => {
    const emitida = await emitidaEm(provider());

    // Instância nova, como se fosse outra requisição — só com o que a borda leu
    // do banco.
    const outra = createSimulatedFiscalProvider({
      now: () => new Date("2026-09-01T15:00:00Z"),
      randomInt: () => 7,
      seed: { documents: [{ ...emitida, cnpjEmitente: CNPJ }] },
    });

    const semSeed = await provider().cancel({ ref: "venda-1", justificativa: JUSTIFICATIVA });
    expect(semSeed.status).toBe("nao_encontrado");

    const comSeed = await outra.cancel({ ref: "venda-1", justificativa: JUSTIFICATIVA });
    expect(comSeed.status).toBe("cancelado");
    expect((await outra.query("venda-1")).status).toBe("cancelado");
  });

  it("mantém a emissão idempotente entre instâncias", async () => {
    const emitida = await emitidaEm(provider());

    const outra = createSimulatedFiscalProvider({
      now: () => new Date("2026-09-01T15:00:00Z"),
      randomInt: () => 7,
      seed: { documents: [{ ...emitida, cnpjEmitente: CNPJ }] },
    });

    const reemitida = await outra.emit({ ref: "venda-1", model: "nfe", payload: payload() });
    expect(reemitida.chave).toBe(emitida.chave);
    expect(reemitida.numero).toBe(emitida.numero);
  });

  it("continua a numeração a partir do último número informado", async () => {
    const fiscal = createSimulatedFiscalProvider({
      now: () => new Date("2026-09-01T15:00:00Z"),
      randomInt: () => 7,
      seed: { lastNumbers: [{ cnpj: CNPJ, model: "nfe", ultimoNumero: 41 }] },
    });

    const document = await fiscal.emit({ ref: "venda-42", model: "nfe", payload: payload() });
    expect(document.numero).toBe("42");
  });

  it("ignora numeração inválida em vez de corromper o contador", async () => {
    const fiscal = createSimulatedFiscalProvider({
      now: () => new Date("2026-09-01T15:00:00Z"),
      randomInt: () => 7,
      seed: {
        lastNumbers: [
          { cnpj: "", model: "nfe", ultimoNumero: 99 },
          { cnpj: CNPJ, model: "nfe", ultimoNumero: -3 },
        ],
      },
    });

    const document = await fiscal.emit({ ref: "venda-1", model: "nfe", payload: payload() });
    expect(document.numero).toBe("1");
  });
});

describe("createFocusProvider — esqueleto até A12", () => {
  it("lança FiscalNotConfiguredError nas sete operações", async () => {
    const fiscal = createFocusProvider();
    expect(fiscal.id).toBe("focus-nfe");

    const chamadas: Array<[string, () => Promise<unknown>]> = [
      ["emit", () => fiscal.emit({ ref: "r", model: "nfe", payload: payload() })],
      ["query", () => fiscal.query("r")],
      ["cancel", () => fiscal.cancel({ ref: "r", justificativa: JUSTIFICATIVA })],
      ["correctionLetter", () => fiscal.correctionLetter({ ref: "r", correcao: CORRECAO })],
      [
        "invalidateRange",
        () =>
          fiscal.invalidateRange({
            ref: "r",
            cnpj: CNPJ,
            model: "nfe",
            serie: 1,
            numeroInicial: 1,
            numeroFinal: 2,
            justificativa: JUSTIFICATIVA,
          }),
      ],
      ["getXml", () => fiscal.getXml("r")],
      ["getDanfe", () => fiscal.getDanfe("r")],
    ];

    for (const [operacao, chamada] of chamadas) {
      await expect(chamada()).rejects.toBeInstanceOf(FiscalNotConfiguredError);
      await expect(chamada()).rejects.toMatchObject({ providerId: "focus-nfe", operation: operacao });
    }
  });
});

describe("registry — qual provedor está ativo", () => {
  it("cai no simulado quando a configuração está vazia ou é desconhecida", () => {
    const avisos: string[] = [];

    expect(resolveFiscalProviderId(undefined)).toBe(DEFAULT_FISCAL_PROVIDER_ID);
    expect(resolveFiscalProviderId("   ")).toBe(DEFAULT_FISCAL_PROVIDER_ID);
    expect(resolveFiscalProviderId("focus", (m) => avisos.push(m))).toBe(DEFAULT_FISCAL_PROVIDER_ID);
    expect(avisos).toHaveLength(1);
  });

  it("não confunde propriedade herdada de Object com id de provedor", () => {
    // `configured in PROVIDER_FACTORIES` (a checagem anterior a A2) dava
    // verdadeiro para "toString" e mandava chamar Object.prototype.toString
    // como se fosse uma fábrica de provedor.
    expect(isFiscalProviderId("toString")).toBe(false);
    expect(isFiscalProviderId("constructor")).toBe(false);
    expect(resolveFiscalProviderId("toString")).toBe(DEFAULT_FISCAL_PROVIDER_ID);
  });

  it("respeita focus-nfe configurado, em vez de silenciosamente simular", () => {
    const avisos: string[] = [];
    const id = resolveFiscalProviderId("focus-nfe", (m) => avisos.push(m));

    expect(id).toBe("focus-nfe");
    expect(avisos).toHaveLength(0);
    expect(createFiscalProvider(id).id).toBe("focus-nfe");
  });
});
