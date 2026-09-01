/**
 * Quais códigos de situação tributária **admitem** base, alíquota e valor no
 * XML — e quais não admitem (B1, 01/09/2026).
 *
 * ## O problema que este arquivo resolve
 *
 * Até B1, `resolveItemsForSale` calculava ICMS/PIS/COFINS sempre que o grupo
 * tributário tivesse alíquota preenchida, sem olhar o CST/CSOSN. Isso produz
 * XML inválido em metade dos casos reais: o schema da SEFAZ **não tem um grupo
 * único de ICMS**, tem um grupo por CST, e a maioria deles não possui os campos
 * `vBC`/`pICMS`/`vICMS`. Declarar ICMS num item com CST 40 (isenta) não é
 * "informação a mais": é rejeição na validação do schema.
 *
 * Por isso o critério aqui não é "o produto paga imposto?" (pergunta de
 * contabilidade) e sim **"o grupo XML deste CST tem onde escrever esses
 * campos?"** — pergunta de schema, que se responde lendo o Manual de
 * Orientação do Contribuinte da NF-e (leiaute 4.00) e é a única que este
 * arquivo se propõe a responder.
 *
 * ## Lista de exclusão, não de inclusão (ICMS e PIS/COFINS)
 *
 * Os dois conjuntos abaixo dizem quem **não** aceita os campos; qualquer código
 * fora deles calcula. A escolha é deliberada e conservadora: um código
 * desconhecido (cadastro digitado errado, tabela nova da SEFAZ que este arquivo
 * ainda não conhece) mantém o comportamento que o sistema já tinha antes de B1,
 * em vez de deixar de declarar imposto silenciosamente. Suprimir só acontece
 * quando **sabemos** que o grupo XML não tem o campo.
 *
 * O IPI é o oposto — ver `ipiCalculaValor` abaixo.
 */

/** Tira espaço e zeros de digitação ("  40 " → "40"). Não completa zeros à esquerda. */
function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim();
}

/**
 * CST de ICMS (Regime Normal) e CSOSN (Simples Nacional) cujo grupo XML **não**
 * tem `vBC`/`pICMS`/`vICMS` do ICMS próprio. CST e CSOSN convivem no mesmo
 * conjunto porque não colidem: CST tem 2 dígitos, CSOSN tem 3.
 *
 * CST (grupos `ICMS30`/`ICMS40`/`ICMS60` do leiaute 4.00):
 * - `30` isenta/não tributada **com** ICMS-ST cobrado — só os campos de ST;
 * - `40` isenta, `41` não tributada, `50` suspensão — grupo `ICMS40`, que tem
 *   apenas `orig`, `CST` e (opcionalmente) `vICMSDeson`/`motDesICMS`;
 * - `60` ICMS cobrado anteriormente por substituição tributária — grupo
 *   `ICMS60`, que só tem os campos `*STRet` (o imposto já foi retido lá atrás).
 *
 * Ficam **de fora** (isto é, calculam) `00`, `10`, `20`, `51`, `70` e `90`:
 * todos têm `vBC`/`pICMS`/`vICMS` no grupo correspondente. `10` e `70` também
 * têm ST, mas o ICMS próprio existe do mesmo jeito — quem cuida da parte de ST
 * é B2, não este arquivo.
 *
 * CSOSN: **só o `900` ("Outros") tem `vBC`/`pICMS`/`vICMS`**. Todos os demais
 * são grupos enxutos — `102`/`103`/`300`/`400` (grupo `ICMSSN102`) trazem só
 * origem e CSOSN; `101` e `201` trazem crédito de Simples (`pCredSN`,
 * `vCredICMSSN`, que é assunto de B8); `202`/`203`/`500` trazem apenas ST.
 */
const ICMS_SEM_VALOR_PROPRIO = new Set([
  // CST — Regime Normal (CRT 3)
  "30",
  "40",
  "41",
  "50",
  "60",
  // CSOSN — Simples Nacional (CRT 1 e 2)
  "101",
  "102",
  "103",
  "201",
  "202",
  "203",
  "300",
  "400",
  "500",
]);

/**
 * O item com este CST/CSOSN admite `vBC`/`pICMS`/`vICMS` do ICMS próprio?
 *
 * Código desconhecido devolve `true` — ver a nota sobre lista de exclusão no
 * cabeçalho do arquivo.
 */
export function icmsCalculaValorProprio(situacaoTributaria: string | null | undefined): boolean {
  return !ICMS_SEM_VALOR_PROPRIO.has(normalizeCode(situacaoTributaria));
}

/**
 * CST de PIS/COFINS (tabela 4.3.3 da SEFAZ) que **não** aceitam
 * `vBC` + alíquota percentual + valor.
 *
 * - `04` monofásica revenda a alíquota zero, `05` por substituição tributária,
 *   `06` alíquota zero, `07` isenta, `08` sem incidência, `09` com suspensão —
 *   todos caem no grupo `PISNT`/`COFINSNT`, que tem **só** o CST.
 * - `03` é o caso diferente e por isso vale o comentário: ele *é* tributado,
 *   mas por **unidade de medida** (grupo `PISQtde`, com `qBCProd` e
 *   `vAliqProd`), não por percentual. O motor de B1 só sabe calcular
 *   percentual; declarar `vBC` + `pPIS` aqui seria escrever no grupo errado.
 *   Quem ensina o motor a calcular por unidade é B5.
 *
 * Todo o resto calcula: `01`/`02` (grupo `PISAliq`) e a faixa `49`–`99`
 * (grupo `PISOutr`, que também tem `vBC` + `pPIS`).
 */
const PIS_COFINS_SEM_ALIQUOTA_PERCENTUAL = new Set(["03", "04", "05", "06", "07", "08", "09"]);

/**
 * O item com este CST de PIS/COFINS admite base + alíquota percentual + valor?
 *
 * CST ausente devolve `true`, mesmo motivo do ICMS: sem saber, mantém o
 * comportamento anterior a B1 em vez de suprimir o imposto em silêncio.
 */
export function pisCofinsCalculaValor(cst: string | null | undefined): boolean {
  return !PIS_COFINS_SEM_ALIQUOTA_PERCENTUAL.has(normalizeCode(cst));
}

/**
 * CSTs de IPI que caem no grupo `IPITrib` — o único com `vBC`, `pIPI` e `vIPI`.
 *
 * Aqui a lista é de **inclusão**, ao contrário de ICMS e PIS/COFINS, e o motivo
 * é que a tabela de CST do IPI é curta e fechada (`00`–`05`, `49`, `50`–`55`,
 * `99`): tudo que não está nestes quatro códigos está no grupo `IPINT`, que
 * carrega apenas o CST. Não existe a categoria "código que este arquivo talvez
 * não conheça" que justificaria a lista de exclusão dos outros dois impostos.
 *
 * - `00` entrada com recuperação de crédito e `50` saída tributada — os dois
 *   casos normais (entrada porque a nota de devolução é nota de entrada);
 * - `49` outras entradas e `99` outras saídas — genéricos, também tributados.
 *
 * Os suprimidos são os de alíquota zero, isenção, imunidade, não tributação e
 * suspensão (`01`–`05`, `51`–`55`), que não têm onde escrever valor.
 */
const IPI_TRIBUTADO = new Set(["00", "49", "50", "99"]);

/** O item com este CST de IPI admite `vBC`/`pIPI`/`vIPI`? CST ausente é `false`. */
export function ipiCalculaValor(cst: string | null | undefined): boolean {
  return IPI_TRIBUTADO.has(normalizeCode(cst));
}
