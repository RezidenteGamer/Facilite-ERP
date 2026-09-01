import { describe, expect, it } from "vitest";
import {
  WILDCARD_UF_DESTINO,
  resolveTaxRule,
  type TaxRuleRow,
} from "../../src/lib/fiscal/taxRules";

// Porte de scripts/tax-rule-resolution-check.mjs, que era o único dos cinco
// scripts de verificação que já não falava com o banco. Vira teste de verdade:
// roda em `npm test`, falha o build, e não depende de credencial nenhuma.

const REGRA_INTERNA: TaxRuleRow = {
  id: "interna",
  regime: "3",
  naturezaOperacao: "Venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "1",
  cfop: "5102",
};

const REGRA_CORINGA: TaxRuleRow = {
  id: "coringa",
  regime: "3",
  naturezaOperacao: "Venda",
  ufOrigem: "SP",
  ufDestino: WILDCARD_UF_DESTINO,
  tipoCliente: "1",
  cfop: "6102",
};

const OPERACAO_INTERNA = {
  regime: "3",
  naturezaOperacao: "Venda",
  ufOrigem: "SP",
  ufDestino: "SP",
  tipoCliente: "1",
};

describe("resolveTaxRule", () => {
  it("acha a regra exata", () => {
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [REGRA_INTERNA]);
    expect(resultado.found).toBe(true);
    if (!resultado.found) return;
    expect(resultado.cfop).toBe("5102");
    expect(resultado.matchedWildcard).toBe(false);
  });

  it("cai no coringa de uf_destino quando não há regra exata", () => {
    const resultado = resolveTaxRule(
      { ...OPERACAO_INTERNA, ufDestino: "MG" },
      [REGRA_INTERNA, REGRA_CORINGA],
    );
    expect(resultado.found).toBe(true);
    if (!resultado.found) return;
    expect(resultado.cfop).toBe("6102");
    expect(resultado.matchedWildcard).toBe(true);
  });

  it("a regra exata ganha do coringa — mais específica vence", () => {
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [REGRA_CORINGA, REGRA_INTERNA]);
    expect(resultado.found).toBe(true);
    if (!resultado.found) return;
    expect(resultado.ruleId).toBe("interna");
  });

  it("não usa coringa em regime, natureza, uf_origem nem tipo_cliente", () => {
    // Só uf_destino aceita '*'. Um '*' em qualquer outra dimensão tem de ser
    // tratado como texto literal, não como coringa — senão uma linha
    // malformada no cadastro passaria a casar com o sistema inteiro.
    const soCoringaEmOutraDimensao: TaxRuleRow = {
      ...REGRA_INTERNA,
      id: "malformada",
      regime: WILDCARD_UF_DESTINO,
    };
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [soCoringaEmOutraDimensao]);
    expect(resultado.found).toBe(false);
  });

  it("normaliza caixa e espaço em volta", () => {
    const bagunçada: TaxRuleRow = {
      ...REGRA_INTERNA,
      id: "bagunçada",
      ufOrigem: " sp ",
      naturezaOperacao: "venda",
    };
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [bagunçada]);
    expect(resultado.found).toBe(true);
  });

  it("recusa empate de mesma especificidade em vez de escolher uma", () => {
    const gemea: TaxRuleRow = { ...REGRA_INTERNA, id: "gemea", cfop: "5405" };
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [REGRA_INTERNA, gemea]);
    expect(resultado.found).toBe(false);
    if (resultado.found) return;
    expect(resultado.ambiguousRuleIds).toEqual(["interna", "gemea"]);
  });

  it("sem regra nenhuma, devolve motivo legível em vez de lançar", () => {
    const resultado = resolveTaxRule(OPERACAO_INTERNA, []);
    expect(resultado.found).toBe(false);
    if (resultado.found) return;
    expect(resultado.reason).toContain("Tributações");
  });
  it("discrimina por tipo_cliente: cada tipo cai na sua regra", () => {
    const internaConsumidorFinal: TaxRuleRow = {
      ...REGRA_INTERNA,
      id: "interna-consumidor-final",
      tipoCliente: "consumidor_final",
      cfop: "5102",
    };
    const coringaContribuinte: TaxRuleRow = {
      ...REGRA_CORINGA,
      id: "coringa-contribuinte",
      tipoCliente: "contribuinte",
    };
    const regras = [internaConsumidorFinal, coringaContribuinte];

    const contribuinte = resolveTaxRule(
      { ...OPERACAO_INTERNA, tipoCliente: "contribuinte" },
      regras,
    );
    expect(contribuinte.found && contribuinte.ruleId).toBe("coringa-contribuinte");

    const consumidorFinal = resolveTaxRule(
      { ...OPERACAO_INTERNA, tipoCliente: "consumidor_final" },
      regras,
    );
    expect(consumidorFinal.found && consumidorFinal.ruleId).toBe("interna-consumidor-final");
  });

  it("o resultado não carrega tributação nenhuma — CST e alíquota são do grupo do produto", () => {
    // Guarda da correção de 19/08/2026: CFOP é da operação, CST/alíquota são do
    // produto. Se alguém voltar a pendurar tributação na regra, este teste cai.
    const resultado = resolveTaxRule(OPERACAO_INTERNA, [REGRA_INTERNA]);
    expect(Object.keys(resultado).sort()).toEqual(["cfop", "found", "matchedWildcard", "ruleId"]);
  });
});
