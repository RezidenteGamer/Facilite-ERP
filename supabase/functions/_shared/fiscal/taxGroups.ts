/**
 * Grupo tributário — o perfil de tributação que fica atrelado ao produto.
 *
 * Correção de 19/08/2026 à etapa 7 (Tributações). A etapa 7 guardava CST e
 * alíquota em `tax_rules`, junto do CFOP, como se todos dependessem só da
 * forma da operação. CFOP depende (venda interna ≠ interestadual, independente
 * do produto); CST/CSOSN e alíquota **não** — dois produtos na mesma operação
 * podem ter tributação diferente (substituição tributária, isento,
 * monofásico, alíquota diferente).
 *
 * O padrão que os ERPs brasileiros de referência usam, e que este projeto
 * seguiu em vez de inventar um desenho próprio: um **grupo tributário** — um
 * perfil nomeado e reutilizável, criado uma vez ("Tributado padrão 18%",
 * "Isento", "Substituição tributária") e atrelado a N produtos. A operação
 * decide o CFOP (`resolveTaxRule`, em `taxRules.ts`); o produto, via seu
 * grupo, decide CST e alíquota.
 */

/** Linha de `tax_groups`, já em camelCase (mesmo formato que o motor genérico expõe). */
export type TaxGroup = {
  id: string;
  code: string;
  name: string;
  /** Aplica-se quando quem emite é Regime Normal (CRT 3). */
  cstIcms: string | null;
  /** Aplica-se quando quem emite é Simples Nacional (CRT 1 ou 2). */
  csosn: string | null;
  aliquotaIcms: number | null;
  /**
   * `pRedBC` em percentual (B1, 01/09/2026): 0 a 100, nulo quando não há
   * redução. A base do item vira `valor × (1 − reducao/100)` antes de a
   * alíquota ser aplicada.
   *
   * **Só ICMS tem esta coluna, e é decisão, não esquecimento**: `pRedBC` (e o
   * `pRedBCST` do ICMS-ST, que é assunto de B2) é o único percentual de redução
   * de base que existe no leiaute 4.00 da NF-e. PIS, COFINS e IPI não têm campo
   * equivalente no XML — uma coluna de redução para eles seria dado sem
   * destino. A mesma constatação já está registrada em A3, no
   * `comment on column fiscal_document_items.icms_reducao_base`.
   */
  reducaoBaseIcms: number | null;
  cstPis: string | null;
  aliquotaPis: number | null;
  /**
   * Alíquota de PIS **em reais por unidade** (`vAliqProd`) — B5, 01/09/2026.
   *
   * É a outra forma de tributar PIS/COFINS, e não uma variação da percentual:
   * o CST `03` cai no grupo XML `PISQtde`, que tem `qBCProd` (quantidade
   * vendida) e `vAliqProd` (o valor em reais por unidade), e **não tem** `vBC`
   * nem `pPIS`. É o regime ad rem — combustíveis, bebidas frias, embalagens —,
   * em que a lei fixa um valor por litro/unidade.
   *
   * Por isso são duas colunas e não uma: `aliquotaPis` é percentual (0 a 100),
   * esta é em reais e não tem teto de 100. Um mesmo grupo não usa as duas ao
   * mesmo tempo — quem escolhe é o CST.
   */
  aliquotaPisValor: number | null;
  cstCofins: string | null;
  aliquotaCofins: number | null;
  /** Alíquota de COFINS em reais por unidade (`vAliqProd`). Ver `aliquotaPisValor`. */
  aliquotaCofinsValor: number | null;
  /**
   * CST de IPI (B1, 01/09/2026). Mora aqui, e não mais só em `products.cst_ipi`,
   * porque a alíquota de IPI passou a morar no grupo: CST e alíquota são as
   * duas metades do mesmo grupo XML (`IPITrib`), e separá-las em tabelas
   * diferentes deixaria o cadastro se contradizer.
   *
   * `products.cst_ipi` continua existindo como **fallback de leitura** para os
   * produtos cadastrados antes de B1 — ver `resolveItemsForSale` e a decisão no
   * AGENTS.md. Grupo vence produto.
   */
  cstIpi: string | null;
  /** Alíquota de IPI em percentual (`pIPI`), 0 a 100. Nula = não tributa IPI. */
  aliquotaIpi: number | null;
  cstIbsCbs: string | null;
  cclasstrib: string | null;
};

/**
 * Qual dos dois códigos de situação tributária do ICMS vale para esta emissão.
 *
 * CST e CSOSN não coexistem na mesma operação: quem é Simples Nacional
 * (CRT 1 ou 2) usa CSOSN, quem é Regime Normal (CRT 3) usa CST. O grupo guarda
 * os dois porque o mesmo cadastro de produto pode ser usado por filiais em
 * regimes diferentes — quem escolhe é o `regime` de quem está emitindo, não o
 * cadastro do produto.
 *
 * Cai no outro código quando o esperado não está preenchido, em vez de
 * devolver nada: um grupo cadastrado só com CSOSN ainda descreve a tributação
 * do produto, e emitir com o código que existe é melhor do que recusar a nota
 * por causa da coluna vazia. Devolve `null` só quando o grupo não tem nenhum
 * dos dois — aí quem chama recusa a emissão com mensagem própria.
 */
export function resolveIcmsSituacaoTributaria(group: TaxGroup, regime: string): string | null {
  return regime === "3" ? (group.cstIcms ?? group.csosn) : (group.csosn ?? group.cstIcms);
}

/**
 * Linha crua de `tax_groups` → `TaxGroup`.
 *
 * Mora no núcleo desde A1 (01/09/2026) porque as duas bordas leem a mesma
 * tabela: a Edge Function `fiscal-emit`, para montar a nota, e o front, para o
 * lookup de "Grupo tributário" no cadastro de Produtos. Duas cópias desta
 * conversão significariam que um campo novo em `tax_groups` poderia chegar à
 * tela sem chegar à nota — que é exatamente o tipo de divergência silenciosa
 * que o núcleo compartilhado existe para impedir.
 */
export function toTaxGroup(row: {
  id: string;
  code: string;
  name: string;
  cst_icms: string | null;
  csosn: string | null;
  aliquota_icms: number | null;
  /** Aceita `undefined`: a linha pode vir de um banco onde B1 ainda não rodou. */
  reducao_base_icms: number | null | undefined;
  cst_pis: string | null;
  aliquota_pis: number | null;
  /** Idem `reducao_base_icms`, agora pela migration de B5. */
  aliquota_pis_valor: number | null | undefined;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  /** Idem `reducao_base_icms`, agora pela migration de B5. */
  aliquota_cofins_valor: number | null | undefined;
  /** Idem `reducao_base_icms`. */
  cst_ipi: string | null | undefined;
  /** Idem `reducao_base_icms`. */
  aliquota_ipi: number | null | undefined;
  cst_ibs_cbs: string | null;
  cclasstrib: string | null;
}): TaxGroup {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cstIcms: row.cst_icms,
    csosn: row.csosn,
    aliquotaIcms: row.aliquota_icms,
    // Os três campos de B1 levam `?? null` e os anteriores não, de propósito:
    // enquanto a migration de B1 não estiver aplicada, o `select` volta **sem**
    // estas colunas e elas chegam aqui como `undefined`. Sem a normalização,
    // `aliquotaIpi !== null` seria verdadeiro para todo grupo do banco e o
    // cálculo de IPI sairia `NaN` — ou recusaria a emissão pedindo um CST de
    // IPI que ninguém cadastrou. A janela entre implantar a função e aplicar a
    // migration é curta, mas é justamente quando isso quebraria tudo.
    reducaoBaseIcms: row.reducao_base_icms ?? null,
    cstPis: row.cst_pis,
    aliquotaPis: row.aliquota_pis,
    // As duas colunas de B5 levam `?? null` pelo mesmo motivo das três de B1
    // logo acima: enquanto a migration não estiver aplicada elas chegam
    // `undefined`, e `undefined !== null` faria todo grupo parecer ter alíquota
    // por unidade cadastrada.
    aliquotaPisValor: row.aliquota_pis_valor ?? null,
    cstCofins: row.cst_cofins,
    aliquotaCofins: row.aliquota_cofins,
    aliquotaCofinsValor: row.aliquota_cofins_valor ?? null,
    cstIpi: row.cst_ipi ?? null,
    aliquotaIpi: row.aliquota_ipi ?? null,
    cstIbsCbs: row.cst_ibs_cbs,
    cclasstrib: row.cclasstrib,
  };
}

/** As colunas de `tax_groups` que `toTaxGroup` precisa — para quem monta o `select`. */
export const TAX_GROUP_COLUMNS =
  "id, code, name, cst_icms, csosn, aliquota_icms, reducao_base_icms, cst_pis, aliquota_pis, " +
  "aliquota_pis_valor, cst_cofins, aliquota_cofins, aliquota_cofins_valor, cst_ipi, aliquota_ipi, " +
  "cst_ibs_cbs, cclasstrib";
