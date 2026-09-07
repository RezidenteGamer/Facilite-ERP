import { describe, expect, it } from "vitest";

import {
  buildNfePayloadFromSale,
  type SaleForInvoice,
  type SaleForInvoiceItem,
} from "@fiscal-core/invoiceMapping.ts";
import type { MvaRuleRow } from "@fiscal-core/mvaRules.ts";
import type { TaxGroup } from "@fiscal-core/taxGroups.ts";
import type { TaxRuleRow } from "@fiscal-core/taxRules.ts";

/**
 * Bateria de **grafia de campo** do payload de emissão (A4, 06/09/2026).
 *
 * Não mede valor de imposto nenhum — isso é o que as dez baterias de B1 a B10
 * fazem. Mede a única coisa que aquelas baterias, por construção, não conseguem
 * medir: se a **chave** com que o valor sai do payload é a que a Focus lê. Um
 * campo com nome errado passa por todo teste de cálculo, porque o teste lê a
 * mesma propriedade que o código escreveu — e só quebra no provedor real, onde
 * o campo é silenciosamente descartado.
 *
 * São dois casos, os dois achados da auditoria de A4:
 *
 * 1. **`cest`**, que se chamava `codigo_cest` e não existe com esse nome em
 *    nenhuma página da Focus (`campos.focusnfe.com.br/nfe/NotaFiscalXML.html`,
 *    `Last-Modified` 22/08/2026, acesso em 06/09/2026: `cest`, tag XML `CEST`).
 *    O CEST nunca teve teste — os fixtures das outras baterias cadastram
 *    `cest: null` no produto e nunca olham o que sai —, e foi exatamente por
 *    isso que o nome errado atravessou de A3 até aqui.
 * 2. **`quantidade_tributavel` e `valor_unitario_tributavel`**, que não saíam.
 *    São obrigatórios no item da NFC-e no schema da Focus
 *    (`doc.focusnfe.com.br/reference/emitir_nfce`, `updatedAt` 12/08/2026) e
 *    ocorrência 1-1 no grupo `prod` do leiaute 4.00 da NF-e.
 */

const MVA_CADASTRADA: MvaRuleRow[] = [
  { id: "mva-teste", ncm: "22021000", ufDestino: "*", mvaOriginal: 40, fcpAliquota: null },
];

const REGRA_VENDA_INTERNA: TaxRuleRow = {
  id: "venda-interna",
  regime: "3",
  naturezaOperacao: "venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "contribuinte",
  cfop: "5102",
};

function taxGroup(): TaxGroup {
  return {
    id: "grupo-1",
    code: "TRIB18",
    name: "Tributado 18%",
    cstIcms: "00",
    csosn: null,
    aliquotaIcms: 18,
    reducaoBaseIcms: null,
    cstPis: "01",
    aliquotaPis: 1.65,
    aliquotaPisValor: null,
    cstCofins: "01",
    aliquotaCofins: 7.6,
    aliquotaCofinsValor: null,
    cstIpi: null,
    aliquotaIpi: null,
    cstIbsCbs: "000",
    cclasstrib: "000001",
  };
}

function item(overrides: Partial<SaleForInvoiceItem["product"]> = {}): SaleForInvoiceItem {
  return {
    quantity: 3,
    unitPrice: 250,
    discountAmount: 0,
    totalAmount: 750,
    product: {
      code: "P-1",
      description: "Produto de teste",
      ncm: "22021000",
      cest: null,
      unidadeComercial: "UN",
      unidadeTributavel: "UN",
      origemMercadoria: "0",
      cstIpi: null,
      taxGroup: taxGroup(),
      ...overrides,
    },
  };
}

function sale(items: SaleForInvoiceItem[]): SaleForInvoice {
  const total = items.reduce((sum, i) => sum + i.totalAmount, 0);
  return {
    code: "V-0001",
    issueDate: "2026-09-01",
    subtotalAmount: total,
    totalAmount: total,
    discountAmount: 0,
    freightAmount: 0,
    branch: {
      cnpj: "00000000000191",
      name: "Facilite Testes LTDA",
      inscricaoEstadual: "123456789",
      regimeTributario: "3",
      aliquotaCreditoIcmsSimples: 1.36,
      logradouro: "Rua Um",
      numero: "10",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01001000",
    },
    contact: {
      name: "Cliente Contribuinte LTDA",
      document: "11222333000181",
      inscricaoEstadual: "987654321",
      indicadorIe: "1",
      regimeTributario: null,
      logradouro: "Rua Dois",
      numero: "20",
      bairro: "Centro",
      municipio: "São Paulo",
      uf: "SP",
      cep: "01002000",
      phone: null,
    },
    items,
    payments: [],
  };
}

function primeiroItem(overrides: Partial<SaleForInvoiceItem["product"]> = {}) {
  const resultado = buildNfePayloadFromSale(sale([item(overrides)]), [REGRA_VENDA_INTERNA], MVA_CADASTRADA);
  if (!resultado.ok) throw new Error(`Emissão recusada: ${resultado.errors.join(" | ")}`);
  return resultado.payload.items[0];
}

describe("CEST sai na chave `cest` (A4)", () => {
  it("copia `products.cest` para o campo `cest` do item", () => {
    const emitido = primeiroItem({ cest: "0300700" });
    expect(emitido.cest).toBe("0300700");
  });

  it("não usa mais a chave antiga `codigo_cest`", () => {
    const emitido = primeiroItem({ cest: "0300700" });
    // A chave antiga não pode reaparecer nem como sinônimo: mandar as duas faria
    // a Focus receber um campo que ela não conhece ao lado do que ela conhece.
    expect(Object.keys(emitido)).not.toContain("codigo_cest");
  });

  it("omite o campo quando o produto não tem CEST cadastrado", () => {
    // Ausente, e não `null`: o payload é o corpo JSON literal da Focus, e um
    // CEST nulo num item sem substituição tributária seria campo inventado.
    expect(primeiroItem().cest).toBeUndefined();
  });
});

describe("quantidade e valor unitário tributáveis (A4)", () => {
  it("declara `quantidade_tributavel` e `valor_unitario_tributavel`", () => {
    const emitido = primeiroItem();
    expect(emitido.quantidade_tributavel).toBe(3);
    expect(emitido.valor_unitario_tributavel).toBe(250);
  });

  it("repete os valores comerciais, porque não há fator de conversão cadastrado", () => {
    const emitido = primeiroItem();
    expect(emitido.quantidade_tributavel).toBe(emitido.quantidade_comercial);
    expect(emitido.valor_unitario_tributavel).toBe(emitido.valor_unitario_comercial);
  });
});
