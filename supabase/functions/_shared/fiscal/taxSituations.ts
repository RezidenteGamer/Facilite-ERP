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
 * origem e CSOSN; `101` e `201` trazem o crédito de Simples (`pCredSN`,
 * `vCredICMSSN`) em vez do próprio — ver `icmsCalculaCreditoSimples`, B8;
 * `202`/`203`/`500` trazem apenas ST.
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
 * CSOSN que declaram `vBC`/`pICMS`/`vICMS` mesmo sendo Simples Nacional — hoje
 * só o `900` ("Outros"), o único CSOSN cujo grupo XML (`ICMSSN900`) tem os três
 * campos (correção de 04/09/2026).
 *
 * Existe para uma coisa só: manter o `900` **fora** da correção da alíquota
 * interestadual do ICMS próprio. O gate normal daquela correção é o regime de
 * quem emite (`CRT 3`), e num cadastro coerente ele já basta — um CSOSN só
 * aparece em filial do Simples. Mas `resolveIcmsSituacaoTributaria` cai no
 * CSOSN quando a filial é de Regime Normal e o grupo não tem CST de ICMS, e
 * nesse caminho o `900` chegaria à correção sem passar por decisão nenhuma.
 *
 * **Por que o `900` fica de fora**: o optante pelo Simples recolhe o ICMS pelo
 * DAS, sobre a receita bruta do mês, e não por alíquota-por-operação. Se o
 * `pICMS` que ele declara num `900` deveria ou não distinguir operação interna
 * de interestadual é pergunta legal própria — o `900` é o catch-all, usado
 * "quando nenhum outro serve", e a resposta depende da situação fática que o
 * cadastro não conhece. Mesmo critério com que B2 o deixou fora do ST e B8 o
 * deixou fora do crédito de Simples: catch-all não entra em automatismo.
 *
 * Lista de **inclusão**, como as de ST, crédito e IPI: código desconhecido
 * devolve `false`. Aqui isso é o lado seguro na direção certa — um CSOSN novo
 * que declare próprio seguiria a regra geral (a alíquota da operação), que é o
 * comportamento correto pela Resolução 22/89; a exceção é que precisa ser
 * afirmada, e é o que este conjunto faz.
 */
const ICMS_PROPRIO_SEM_ALIQUOTA_POR_OPERACAO = new Set(["900"]);

/**
 * O `pICMS`/`vICMS` deste código é declarado por um regime que **não** apura o
 * ICMS por operação (Simples Nacional)? Então a alíquota interestadual não se
 * aplica a ele — ver o comentário do conjunto acima.
 */
export function icmsProprioIgnoraAliquotaInterestadual(
  situacaoTributaria: string | null | undefined,
): boolean {
  return ICMS_PROPRIO_SEM_ALIQUOTA_POR_OPERACAO.has(normalizeCode(situacaoTributaria));
}

/**
 * CST de ICMS e CSOSN cujo grupo XML tem os campos de **ICMS-ST a recolher
 * agora** (`modBCST`, `pMVAST`, `vBCST`, `pICMSST`, `vICMSST`) — B2,
 * 01/09/2026.
 *
 * Esta é uma dimensão **diferente** de `ICMS_SEM_VALOR_PROPRIO`, e não o
 * complemento dela: o `10` e o `70` têm ICMS próprio **e** ST; o `30` e os
 * CSOSN `201`/`202`/`203` têm ST **sem** próprio. As duas perguntas se fazem
 * separadamente para o mesmo item, e é por isso que são dois conjuntos.
 *
 * - CST `10` (tributada **com** cobrança de ST) e `70` (a mesma coisa, com
 *   redução de base no próprio) — grupos `ICMS10`/`ICMS70`;
 * - CST `30` (isenta/não tributada **com** cobrança de ST) — grupo `ICMS30`,
 *   que só tem os campos de ST, nenhum do próprio;
 * - CSOSN `201` (com crédito de Simples e com ST), `202` e `203` (com ST, sem
 *   crédito) — grupos `ICMSSN201`/`ICMSSN202`. O `pCredSN` do `201` é de
 *   `icmsCalculaCreditoSimples` (B8); a parte de ST deles é aqui.
 *
 * **Ficam de fora, e cada um por um motivo próprio:**
 *
 * - CST `60` e CSOSN `500` — ICMS **já retido anteriormente** na cadeia. O
 *   grupo XML deles (`ICMS60`/`ICMSSN500`) tem `vBCSTRet`/`vICMSSTRet`, que
 *   declaram o que outro contribuinte reteve lá atrás, sem MVA nenhuma. O dado
 *   ("quanto de ST veio embutido no custo da compra") este sistema não guarda,
 *   e inventá-lo seria pior do que a omissão — fora do escopo de B2.
 * - CST `90` e CSOSN `900` ("Outros") — os grupos deles **aceitam** ST, mas
 *   como catch-all: são o código que se usa quando nenhum outro serve, e a ST
 *   neles é opcional. Incluí-los aqui obrigaria toda venda com CST 90 a ter
 *   MVA cadastrada, recusando emissões que hoje saem corretas. Quem precisar
 *   de ST tem `10`/`30`/`70` para dizê-lo explicitamente.
 */
const ICMS_COM_SUBSTITUICAO_TRIBUTARIA = new Set([
  // CST — Regime Normal (CRT 3)
  "10",
  "30",
  "70",
  // CSOSN — Simples Nacional (CRT 1 e 2)
  "201",
  "202",
  "203",
]);

/**
 * O item com este CST/CSOSN declara ICMS-ST a recolher nesta operação?
 *
 * Ao contrário de `icmsCalculaValorProprio`, aqui a lista é de **inclusão**:
 * código desconhecido devolve `false`. O motivo é o oposto do de lá — o risco
 * daquela função é suprimir imposto em silêncio, e o desta é **exigir um
 * cadastro de MVA que ninguém tem** e recusar a emissão. Na dúvida, não há ST.
 */
export function icmsCalculaSubstituicaoTributaria(situacaoTributaria: string | null | undefined): boolean {
  return ICMS_COM_SUBSTITUICAO_TRIBUTARIA.has(normalizeCode(situacaoTributaria));
}

/**
 * CSOSN cujo grupo XML declara o **crédito de ICMS do Simples Nacional** —
 * `pCredSN` (alíquota aplicável de cálculo do crédito) e `vCredICMSSN` (o valor
 * que o destinatário pode aproveitar nos termos do art. 23 da LC 123/2006).
 * B8, 03/09/2026.
 *
 * É a terceira dimensão do ICMS deste arquivo, e de novo **não** é o
 * complemento das outras duas: o `101` não tem próprio nem ST e tem crédito; o
 * `201` tem ST e crédito; o `202` tem ST e não tem crédito. As três perguntas
 * se fazem separadamente para o mesmo item.
 *
 * Só existe no Simples Nacional: é o mecanismo pelo qual o optante, que paga o
 * ICMS embutido no DAS e por isso **não destaca `vICMS`**, informa ao
 * comprador de Regime Normal quanto daquele DAS foi ICMS, para o comprador
 * creditar-se. Não há equivalente nos CST de Regime Normal, onde o `vICMS`
 * destacado já é o crédito.
 *
 * - `101` "Tributada pelo Simples Nacional **com permissão de crédito**" —
 *   grupo `ICMSSN101`, que tem exatamente quatro campos: `orig`, `CSOSN`,
 *   `pCredSN` e `vCredICMSSN`. Não tem `vBC` (por isso a base do crédito não
 *   viaja no XML: o fisco a refaz do valor do produto).
 * - `201` "Tributada com permissão de crédito **e com cobrança de ST**" —
 *   grupo `ICMSSN201`, que soma os campos de ST aos dois do crédito. É a
 *   metade que B2 deixou de fora de propósito.
 *
 * **Nos dois, os dois campos são obrigatórios** (`S` na tabela de campos do
 * leiaute 4.00, conferida antes de implementar): omiti-los é a rejeição de
 * schema "o conteúdo do elemento ICMSSN101 está incompleto. Esperado
 * pCredSN". É o que justifica a recusa por cadastro incompleto em
 * `resolveCreditoSimples` — ver a nota lá.
 *
 * **O `900` ficou de fora, e é decisão.** O grupo `ICMSSN900` também aceita
 * `pCredSN`/`vCredICMSSN`, mas como opcional (`?` na tabela — "a exigência
 * depende da situação fática"), porque é o catch-all: é o código que se usa
 * quando nenhum outro serve. Como a alíquota de crédito é cadastro **da
 * filial** e vale para toda nota que ela emite, incluir o `900` faria o
 * crédito ser declarado automaticamente em operações que o contador marcou
 * justamente como "nenhuma das anteriores" — e o crédito tem vedações legais
 * (art. 23, §4º, da LC 123/2006) que o cadastro não sabe verificar. Quem quer
 * transferir crédito tem o `101` e o `201` para dizê-lo explicitamente. Mesmo
 * critério com que B2 deixou o `900` fora do ST.
 */
const ICMS_COM_CREDITO_SIMPLES = new Set(["101", "201"]);

/**
 * O item com este CSOSN declara `pCredSN`/`vCredICMSSN`?
 *
 * Lista de **inclusão**, como as de ST e de IPI: código desconhecido devolve
 * `false`. Aqui isso importa porque a resposta `true` **exige o cadastro** da
 * alíquota de crédito na filial e recusa a emissão sem ela.
 */
export function icmsCalculaCreditoSimples(situacaoTributaria: string | null | undefined): boolean {
  return ICMS_COM_CREDITO_SIMPLES.has(normalizeCode(situacaoTributaria));
}

/**
 * CSOSN em que o ICMS da operação própria **existe mas não é destacado**, e
 * por isso entra no cálculo do ICMS-ST como dedução ainda que nenhum `vICMS`
 * apareça no XML (B8, 03/09/2026).
 *
 * É a lacuna que B2 registrou como limitação conhecida ("Simples Nacional: não
 * há dedução nenhuma") e que esta função fecha. O ICMS-ST é o imposto de toda
 * a cadeia **menos** o que a operação própria já cobrou; num CSOSN de Simples
 * o próprio foi cobrado (dentro do DAS), só não foi destacado — então deduzir
 * zero faz o ST sair sobre a base majorada inteira, várias vezes maior que o
 * devido. A base legal do cálculo é o art. 13, §1º, XIII, "a", da LC 123/2006,
 * que tira o ICMS-ST do recolhimento unificado e manda observar "a legislação
 * aplicável às demais pessoas jurídicas" — isto é, a fórmula geral, com a
 * dedução; a única especialidade do optante é não usar MVA ajustada (Convênio
 * ICMS 35/2011, já tratado em B2).
 *
 * - `201` (tributada, com crédito, com ST) e `202` (tributada, sem crédito,
 *   com ST) — nos dois a operação própria **é tributada**, e é ela que se
 *   deduz.
 *
 * **O `203` ficou de fora de propósito**: ele é "**isenção** do ICMS no
 * Simples Nacional para faixa de receita bruta, com cobrança de ICMS por
 * substituição tributária". Operação própria isenta não tem imposto para
 * deduzir — exatamente o mesmo motivo pelo qual o CST `30` (isenta/não
 * tributada com ST) já saía sem dedução desde B2, com teste fixando isso.
 */
const ICMS_ST_COM_DEDUCAO_PROPRIA_NAO_DESTACADA = new Set(["201", "202"]);

/**
 * A operação própria deste CSOSN se deduz do ICMS-ST mesmo sem `vICMS` no XML?
 *
 * Lista de inclusão: código desconhecido devolve `false` — na dúvida, não há
 * dedução, que é o comportamento anterior a B8.
 */
export function icmsStDeduzProprioNaoDestacado(situacaoTributaria: string | null | undefined): boolean {
  return ICMS_ST_COM_DEDUCAO_PROPRIA_NAO_DESTACADA.has(normalizeCode(situacaoTributaria));
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
 *   `vAliqProd`), não por percentual. Declarar `vBC` + `pPIS` aqui seria
 *   escrever no grupo errado — e é por isso que ele continua nesta lista
 *   **depois de B5**: quem calcula o `03` é `pisCofinsCalculaValorPorUnidade`,
 *   logo abaixo, e a pergunta desta função (“tem alíquota **percentual**?”)
 *   segue tendo `false` como resposta certa para ele.
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
 * CST de PIS/COFINS que declaram o imposto **por unidade de medida** — o grupo
 * `PISQtde`/`COFINSQtde`, com `qBCProd` (quantidade vendida), `vAliqProd`
 * (alíquota em reais por unidade) e `vPIS`/`vCOFINS` (B5, 01/09/2026).
 *
 * Só o `03` ("Operação Tributável com Alíquota por Unidade de Medida de
 * Produto", tabela 4.3.3). É o regime **ad rem** — combustíveis, álcool,
 * embalagens e bebidas frias —, em que a lei fixa um valor em reais por
 * litro/unidade em vez de um percentual sobre a receita.
 *
 * Lista de **inclusão**, como a do IPI e a de ST, e pelo mesmo motivo delas:
 * código desconhecido devolve `false`, porque o risco desta função é o oposto
 * do de `pisCofinsCalculaValor` — aqui a resposta `true` **exige um cadastro
 * que ninguém tem** (a alíquota em reais) e recusa a emissão. Na dúvida, o
 * item segue pelo caminho percentual, que é o que o sistema sempre fez.
 *
 * ## O que ficou de fora de propósito: a faixa `49`–`99`
 *
 * O grupo `PISOutr` do leiaute 4.00 é uma **escolha** (`xs:choice`): ou
 * `vBC` + `pPIS`, ou `qBCProd` + `vAliqProd` — nunca os dois. Ou seja, um item
 * com CST `99` também pode, legitimamente, ser tributado por unidade. Este
 * arquivo não o inclui porque o cadastro não tem como dizer **qual das duas
 * formas** aquele grupo usa: com as duas alíquotas preenchidas (a percentual,
 * que existe desde sempre, e a em reais, criada por B5) não há critério para
 * desempatar, e escolher errado é declarar o campo errado no XML. O `03` não
 * tem essa ambiguidade — o grupo `PISQtde` só tem a forma por unidade.
 * Continua sendo percentual, portanto, tudo que não é `03`.
 */
const PIS_COFINS_POR_UNIDADE = new Set(["03"]);

/**
 * O item com este CST de PIS/COFINS declara `qBCProd`/`vAliqProd`/`vPIS`?
 *
 * É a pergunta **irmã** de `pisCofinsCalculaValor`, não a negação dela: as duas
 * respondem `false` para os CST `04`–`09` (grupo `PISNT`, que não tem valor
 * nenhum), e para o `03` só esta responde `true`.
 */
export function pisCofinsCalculaValorPorUnidade(cst: string | null | undefined): boolean {
  return PIS_COFINS_POR_UNIDADE.has(normalizeCode(cst));
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
