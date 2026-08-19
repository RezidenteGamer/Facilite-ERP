/**
 * Resolução de regra fiscal (Tributações).
 *
 * `resolveTaxRule` é a função pura que a etapa 8 (Notas Emitidas) vai chamar
 * para montar a parte de imposto do `payload` do `FiscalProvider` (ver
 * `src/lib/fiscal/types.ts`, `NfePayloadItem`). Esta etapa não aplica a regra
 * em nenhuma venda — só produz a função e a tabela (`tax_rules`) que ela lê.
 *
 * Mesmo espírito de `FiscalProvider`: nunca lança exceção para "não achei
 * regra" — devolve um resultado explícito que quem chama consegue mostrar
 * como "cadastre uma regra para esta operação" em vez de quebrar a emissão.
 */

/** Linha de `tax_rules`, já em camelCase (o mesmo formato que o motor genérico expõe). */
export type TaxRuleRow = {
  id: string;
  regime: string;
  naturezaOperacao: string;
  ufOrigem: string;
  /** Pode ser `'*'` — ver `WILDCARD_UF_DESTINO`. */
  ufDestino: string;
  tipoCliente: string;
  cfop: string;
  cstIcms: string | null;
  csosn: string | null;
  aliquotaIcms: number | null;
  cstPis: string | null;
  aliquotaPis: number | null;
  cstCofins: string | null;
  aliquotaCofins: number | null;
  cstIbsCbs: string | null;
  cclasstrib: string | null;
};

/** As cinco dimensões de uma operação — o que decide qual regra se aplica. */
export type TaxRuleQuery = {
  /** CRT de quem emite (mesmo código de `branches.regime_tributario`: '1', '2' ou '3'). */
  regime: string;
  naturezaOperacao: string;
  ufOrigem: string;
  ufDestino: string;
  tipoCliente: string;
};

/** Valor de `uf_destino` que significa "qualquer UF destino" — ver a coluna em `tax_rules`. */
export const WILDCARD_UF_DESTINO = "*";

export type TaxRuleResolution =
  | { found: true; rule: TaxRuleRow; matchedWildcard: boolean }
  | {
      found: false;
      /** Mensagem pronta para a tela mostrar ("cadastre uma regra para esta operação"). */
      reason: string;
      /**
       * Presente só no caso defensivo de duas regras empatarem na mesma
       * especificidade (a constraint `tax_rules_dimensions_unique` no banco
       * já impede isso para dados reais — este campo existe para quem chamar
       * esta função com dados de teste/fora do banco não ficar sem sinal do
       * empate, em vez de a função escolher uma prioridade arbitrária).
       */
      ambiguousRuleIds?: string[];
    };

function norm(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Resolve a regra fiscal aplicável a uma operação.
 *
 * Critério de desempate quando mais de uma regra combina: **mais específica
 * vence** — uma regra com `uf_destino` exato bate uma regra coringa
 * (`uf_destino = '*'`). É o único eixo de coringa que `tax_rules` permite
 * (regime/natureza/UF origem/tipo de cliente são sempre exigidos exatos), e a
 * constraint `tax_rules_dimensions_unique` garante que existe no máximo uma
 * regra exata e uma regra coringa para a mesma combinação — nunca duas do
 * mesmo tipo brigando pelo mesmo lugar.
 */
export function resolveTaxRule(query: TaxRuleQuery, rules: TaxRuleRow[]): TaxRuleResolution {
  const q = {
    regime: norm(query.regime),
    naturezaOperacao: norm(query.naturezaOperacao),
    ufOrigem: norm(query.ufOrigem),
    ufDestino: norm(query.ufDestino),
    tipoCliente: norm(query.tipoCliente),
  };

  const candidates = rules.filter((rule) => {
    if (norm(rule.regime) !== q.regime) return false;
    if (norm(rule.naturezaOperacao) !== q.naturezaOperacao) return false;
    if (norm(rule.ufOrigem) !== q.ufOrigem) return false;
    if (norm(rule.tipoCliente) !== q.tipoCliente) return false;
    const ruleUfDestino = norm(rule.ufDestino);
    return ruleUfDestino === q.ufDestino || ruleUfDestino === WILDCARD_UF_DESTINO;
  });

  if (candidates.length === 0) {
    return {
      found: false,
      reason:
        `Nenhuma regra cadastrada para regime ${query.regime}, natureza "${query.naturezaOperacao}", ` +
        `${query.ufOrigem} → ${query.ufDestino}, cliente ${query.tipoCliente}. Cadastre uma regra em Tributações.`,
    };
  }

  const exact = candidates.filter((rule) => norm(rule.ufDestino) !== WILDCARD_UF_DESTINO);
  const winners = exact.length > 0 ? exact : candidates;

  if (winners.length > 1) {
    return {
      found: false,
      reason:
        "Mais de uma regra de mesma especificidade se aplica a esta operação — corrija o cadastro em Tributações.",
      ambiguousRuleIds: winners.map((rule) => rule.id),
    };
  }

  const rule = winners[0];
  return { found: true, rule, matchedWildcard: norm(rule.ufDestino) === WILDCARD_UF_DESTINO };
}
