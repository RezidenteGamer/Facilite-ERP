/**
 * Resolução de CFOP pela forma da operação (Tributações).
 *
 * `resolveTaxRule` é a função pura que Notas Emitidas (etapa 8) chama para
 * descobrir **o CFOP** de uma operação. Não lê o banco — quem chama já buscou
 * as regras (a função não sabe o que é Supabase).
 *
 * Mesmo espírito de `FiscalProvider`: nunca lança exceção para "não achei
 * regra" — devolve um resultado explícito que quem chama consegue mostrar
 * como "cadastre uma regra para esta operação" em vez de quebrar a emissão.
 *
 * ## Só CFOP — a correção de 19/08/2026
 *
 * A primeira versão desta função devolvia a regra inteira: CFOP **e**
 * CST/alíquota. Estava errada pela metade. CFOP realmente depende da forma da
 * operação — uma venda interna e uma interestadual têm CFOPs diferentes
 * independente do produto vendido. **CST/CSOSN e alíquota, não**: dois
 * produtos na mesma operação (mesma UF origem/destino, mesmo tipo de cliente)
 * podem ter tributação diferente — um com substituição tributária, outro
 * isento, outro monofásico. Uma regra por combinação de operação não tem como
 * representar isso.
 *
 * Quem decide CST/alíquota agora é o **grupo tributário do produto**
 * (`products.tax_group_id` → `tax_groups`, ver `taxGroups.ts`) — o padrão que
 * os ERPs brasileiros de referência usam. Quem monta o item de uma nota
 * precisa dos dois: esta função para o CFOP, e o grupo do produto para
 * CST/alíquota.
 */

/**
 * Linha de `tax_rules`, já em camelCase (o mesmo formato que o motor genérico
 * expõe). Só as cinco dimensões de entrada e o CFOP — os campos de saída de
 * tributação saíram da tabela na correção de 19/08/2026.
 */
export type TaxRuleRow = {
  id: string;
  regime: string;
  naturezaOperacao: string;
  ufOrigem: string;
  /** Pode ser `'*'` — ver `WILDCARD_UF_DESTINO`. */
  ufDestino: string;
  tipoCliente: string;
  cfop: string;
};

/**
 * Linha crua de `tax_rules` → `TaxRuleRow`.
 *
 * No núcleo desde A1 (01/09/2026), mesmo motivo de `toTaxGroup`: quem lê a
 * tabela agora é a Edge Function `fiscal-emit`, e a conversão não pode existir
 * em dois lugares.
 */
export function toTaxRuleRow(row: {
  id: string;
  regime: string;
  natureza_operacao: string;
  uf_origem: string;
  uf_destino: string;
  tipo_cliente: string;
  cfop: string;
}): TaxRuleRow {
  return {
    id: row.id,
    regime: row.regime,
    naturezaOperacao: row.natureza_operacao,
    ufOrigem: row.uf_origem,
    ufDestino: row.uf_destino,
    tipoCliente: row.tipo_cliente,
    cfop: row.cfop,
  };
}

/** As cinco dimensões de uma operação — o que decide qual CFOP se aplica. */
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
  | {
      found: true;
      /** O único dado de saída que uma regra carrega. CST/alíquota vêm do grupo do produto. */
      cfop: string;
      /** Qual linha de `tax_rules` decidiu — para rastrear/depurar, não para ler tributação dela. */
      ruleId: string;
      matchedWildcard: boolean;
    }
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
 * Resolve o CFOP aplicável a uma operação.
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
  return {
    found: true,
    cfop: rule.cfop,
    ruleId: rule.id,
    matchedWildcard: norm(rule.ufDestino) === WILDCARD_UF_DESTINO,
  };
}
