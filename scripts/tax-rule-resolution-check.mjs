/**
 * Prova de que `resolveTaxRule` (`src/lib/fiscal/taxRules.ts`) resolve regra
 * exata, regra coringa e "nenhuma regra cadastrada" sem lançar exceção —
 * mesmo espírito de `scripts/fiscal-cycle-check.mjs` (etapa F1), mas sem
 * banco/rede: a função é pura, então o teste roda sobre um array de regras
 * fixo, montado só para este script.
 *
 * Rode com:  node scripts/tax-rule-resolution-check.mjs
 *
 * Passa pelo Vite (`ssrLoadModule`) pelo mesmo motivo do script da etapa F1:
 * o Node exige extensão explícita em imports relativos, e o projeto inteiro
 * importa sem extensão — carregar via Vite resolve exatamente como o app.
 *
 * Atualizado na correção de 19/08/2026: a função devolve **só o CFOP**
 * (`result.cfop`/`result.ruleId`), não mais a regra inteira com CST/alíquota —
 * esses passaram a vir do grupo tributário do produto (`tax_groups`). As
 * regras de teste abaixo, por consequência, também só têm CFOP como saída.
 */

import { createServer } from "vite";

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  const mark = ok ? "  ok  " : " FALHA";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { resolveTaxRule, WILDCARD_UF_DESTINO } = await server.ssrLoadModule("/src/lib/fiscal/taxRules.ts");

/** Regras de teste — não vêm do banco, só para exercitar a função isoladamente. */
const rules = [
  {
    id: "rule-sp-rj-exata",
    regime: "3",
    naturezaOperacao: "venda",
    ufOrigem: "SP",
    ufDestino: "RJ",
    tipoCliente: "contribuinte",
    cfop: "6102",
  },
  {
    id: "rule-sp-coringa",
    regime: "3",
    naturezaOperacao: "venda",
    ufOrigem: "SP",
    ufDestino: WILDCARD_UF_DESTINO,
    tipoCliente: "contribuinte",
    cfop: "6108",
  },
  {
    id: "rule-sp-interna-consumidor-final",
    regime: "3",
    naturezaOperacao: "venda",
    ufOrigem: "SP",
    ufDestino: "SP",
    tipoCliente: "consumidor_final",
    cfop: "5102",
  },
];

/* 1. Bate regra exata (SP -> RJ, contribuinte) mesmo com a coringa SP -> * também elegível. */
{
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "RJ", tipoCliente: "contribuinte" },
    rules,
  );
  check("bate regra exata (SP -> RJ)", result.found === true && result.ruleId === "rule-sp-rj-exata");
  check("regra exata não é marcada como coringa", result.found === true && result.matchedWildcard === false);
  check("CFOP da regra exata é o dela, não o da coringa", result.found === true && result.cfop === "6102");
}

/* 2. Só bate por coringa (SP -> MG, contribuinte — não há regra específica para MG). */
{
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "MG", tipoCliente: "contribuinte" },
    rules,
  );
  check("bate a regra coringa quando não há regra exata", result.found === true && result.ruleId === "rule-sp-coringa");
  check("regra coringa é marcada como tal", result.found === true && result.matchedWildcard === true);
}

/* 3. Sem regra nenhuma cadastrada (natureza "devolucao" não tem nenhuma regra nos dados de teste). */
{
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: "devolucao", ufOrigem: "SP", ufDestino: "RJ", tipoCliente: "contribuinte" },
    rules,
  );
  check("sem regra cadastrada devolve found: false, não lança exceção", result.found === false);
  check(
    "mensagem de 'sem regra' é acionável (menciona Tributações)",
    result.found === false && result.reason.toLowerCase().includes("tributações"),
  );
}

/* 4. Case-insensitive / espaço nas pontas não deveria impedir o match. */
{
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: " Venda ", ufOrigem: "sp", ufDestino: "rj", tipoCliente: "Contribuinte" },
    rules,
  );
  check("normaliza caixa/espaço nas dimensões de entrada", result.found === true && result.ruleId === "rule-sp-rj-exata");
}

/* 5. tipo_cliente diferente muda a regra (SP -> SP, consumidor_final vs. contribuinte). */
{
  const asContribuinte = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "SP", tipoCliente: "contribuinte" },
    rules,
  );
  const asConsumidorFinal = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "SP", tipoCliente: "consumidor_final" },
    rules,
  );
  check(
    "SP -> SP contribuinte só bate a coringa (nenhuma regra interna p/ contribuinte)",
    asContribuinte.found === true && asContribuinte.ruleId === "rule-sp-coringa",
  );
  check(
    "SP -> SP consumidor_final bate a regra interna específica",
    asConsumidorFinal.found === true && asConsumidorFinal.ruleId === "rule-sp-interna-consumidor-final",
  );
}

/* 6. Empate defensivo: duas regras "exatas" para a mesma combinação (não deveria existir no banco
      real, por causa da unique constraint) não deve fazer a função escolher uma arbitrariamente. */
{
  const duplicated = [
    { ...rules[0] },
    { ...rules[0], id: "rule-sp-rj-exata-duplicada" },
  ];
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "RJ", tipoCliente: "contribuinte" },
    duplicated,
  );
  check(
    "empate entre duas regras exatas devolve found: false com as duas sinalizadas, não escolhe uma",
    result.found === false && Array.isArray(result.ambiguousRuleIds) && result.ambiguousRuleIds.length === 2,
  );
}

/* 7. A correção em si: o resultado não carrega mais tributação nenhuma — CST e alíquota
      são do grupo tributário do produto, não da regra da operação. */
{
  const result = resolveTaxRule(
    { regime: "3", naturezaOperacao: "venda", ufOrigem: "SP", ufDestino: "RJ", tipoCliente: "contribuinte" },
    rules,
  );
  const chaves = Object.keys(result).sort().join(",");
  check(
    "resultado só expõe cfop/ruleId/matchedWildcard — nenhum CST ou alíquota",
    chaves === "cfop,found,matchedWildcard,ruleId",
    chaves,
  );
}

await server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram.`);
if (failed.length > 0) {
  console.log("Falharam:", failed.map((r) => r.label).join("; "));
  process.exit(1);
}
