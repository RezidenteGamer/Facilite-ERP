/**
 * IBS e CBS — os dois tributos novos da Reforma Tributária, no ano de teste
 * (B10, 05/09/2026).
 *
 * ## O que a EC 132/2023 e a LC 214/2025 puseram dentro do item da nota
 *
 * O grupo `UB` (`det/imposto/IBSCBS`) da NT 2025.002-RTC é o primeiro grupo
 * deste motor que **não descreve um imposto que a loja recolhe hoje**. Em 2026
 * o IBS e a CBS existem, são destacados e são apurados — e o que for recolhido
 * volta na mesma medida:
 *
 * > Art. 348. Em relação aos fatos geradores ocorridos de 1º de janeiro a 31 de
 * > dezembro de 2026: I — o montante recolhido do IBS e da CBS será compensado
 * > com o valor devido, no mesmo período de apuração, das contribuições
 * > previstas no art. 195, inciso I, alínea "b", e inciso IV, e da contribuição
 * > para o PIS […]
 * >
 * > § 1º Fica **dispensado o recolhimento** do IBS e da CBS relativo aos fatos
 * > geradores ocorridos no período indicado no caput em relação aos sujeitos
 * > passivos que **cumprirem as obrigações acessórias** previstas na legislação.
 * >
 * > — LC 214/2025, art. 348, com a redação da LC 227/2026
 *
 * Isto é: o número que este arquivo calcula não sai do caixa de ninguém em
 * 2026 — **desde que ele esteja na nota**. A obrigação acessória *é* o imposto,
 * nesta fase. É por isso que a falta de cadastro aqui **recusa a emissão**, e
 * não omite o campo como o `vTotTrib` de B9 faz: ver a seção sobre a UB12-10
 * mais abaixo.
 *
 * ## As alíquotas de 2026 são fixadas por lei, e o validador as confere
 *
 * - **IBS estadual — 0,1%.** "Art. 343. Em relação aos fatos geradores
 *   ocorridos de 1º de janeiro a 31 de dezembro de 2026, o IBS será cobrado
 *   mediante aplicação da **alíquota estadual de 0,1%**". A regra de validação
 *   `UB18-10` transcreve isso ("0,1% para documento com data de emissão no ano
 *   de 2025 e 2026") e a violação é a **rejeição 1026**.
 * - **IBS municipal — 0%.** O art. 343 não fixa alíquota municipal nenhuma para
 *   2026 (a municipal só aparece no art. 344, com 0,05% a partir de 2027), e a
 *   `UB37-10` fecha a leitura: "0% para documento com data de emissão no ano de
 *   2025 e 2026". O grupo `gIBSMun` continua **obrigatório** — o que é zero é a
 *   alíquota, não a existência do grupo.
 * - **CBS — 0,9%.** "Art. 346. […] a CBS será cobrada mediante aplicação da
 *   alíquota de 0,9%", transcrito na `UB56-10`.
 *
 * **Elas não são iguais para todo mundo**, e é o erro fácil desta tarefa: o
 * art. 348, III, "a", manda que as alíquotas dos arts. 343 e 346 "serão
 * aplicadas **com a respectiva redução** no caso das operações sujeitas a
 * alíquota reduzida, no âmbito de regimes diferenciados de tributação". Ou
 * seja, o `cClassTrib` continua modulando a carga **mesmo no ano de teste** —
 * a cesta básica com redução de 100% declara 0,1% nominal e **0%** efetivo, e
 * quem mandar 0,1% cheio nela erra a `UB35-10` (rejeição 1041).
 *
 * ## O Simples Nacional não entra nesta fase
 *
 * Art. 348, III, "c": as alíquotas de 2026 "**não serão aplicadas** em relação
 * às operações dos contribuintes optantes pelo Simples Nacional". A NT 2025.002
 * repete no cronograma dela, com todas as letras: "As orientações para CRT=1 –
 * Simples Nacional, CRT=2 – Simples Nacional, excesso sublimite de receita
 * bruta, CRT=4 – MEI e Tributação Monofásica serão publicadas em NT futura,
 * tendo em vista que a tributação do IBS/CBS/IS para estes contribuintes ocorre
 * somente a partir de 2027, conforme disposto no Art. 348 da LC 214/25" — e a
 * `UB12-10` só passa a exigir o grupo desses CRT em **04/01/2027**.
 *
 * Por isso o gate de regime deste arquivo é `regimeOptantePeloSimples`, a mesma
 * função que B4 usa para o DIFAL — mas por um motivo diferente: lá o Simples é
 * excluído porque **não deve** o imposto (ADI 5464); aqui porque a lei ainda
 * **não o alcança**. A nota de um CRT 1/2/4 sai sem o grupo, e isso é o certo.
 *
 * ## Por que a falta de cadastro recusa (e o `vTotTrib` de B9 não recusava)
 *
 * A regra `UB12-10` da NT 2025.002-RTC v1.51 diz, literalmente, "Não informado
 * grupo de imposto IBS e CBS (grupo: det/imposto/IBSCBS)" e devolve a
 * **rejeição 1115**. As observações dela dão as datas:
 *
 * > Observação 1: implementação em homologação para NFe com data de emissão
 * > maior ou igual a 01/07/2026 e emitente com CRT 3 = Regime Normal.
 * > Observação 2: implementação em **produção** para NFe com data de emissão
 * > maior ou igual a **03/08/2026** e emitente com CRT 3 = Regime Normal.
 * > Observação 3: implementação em produção para emitente com CRT 1, 2 ou 4 a
 * > partir de 04/01/2027.
 *
 * O cronograma administrativo confirma pelo outro lado: o Ato Conjunto
 * RFB/CGIBS nº 4, de 30/07/2026 (DOU de 31/07/2026), pôs a NF-e e a NFC-e em
 * **03/08/2026** e o Simples Nacional em 01/01/2027.
 *
 * Consequência prática, e é a razão de esta tarefa ser a primeira desde B8 a
 * **quebrar** notas que hoje saem: uma NF-e de Regime Normal emitida hoje sem o
 * grupo `IBSCBS` **é rejeitada pela SEFAZ**. Recusar aqui, com o nome do grupo
 * tributário na mensagem, é estritamente melhor do que mandar a nota para
 * tomar 1115 — é a mesma escolha de B1/B2/B5/B8, e o `vTotTrib` de B9 continua
 * sendo a exceção que ele sempre foi (campo opcional, informativo, que nenhuma
 * regra exige).
 *
 * ## As duas tabelas oficiais que este arquivo carrega
 *
 * Elas vêm do **Informe Técnico 2025.002 v.1.60, publicado em 23/06/2026** no
 * Portal Nacional da NF-e, cujo conteúdo é servido em formato interativo pelo
 * Portal DFe da SVRS
 * (https://dfe-portal.svrs.rs.gov.br/DFE/TabelaClassificacaoTributaria).
 *
 * 1. **Tabela CST do IBS/CBS** — 18 códigos, cada um com os *indicadores* que
 *    dizem quais grupos do leiaute ele exige, permite ou veda. É a mesma
 *    pergunta que `taxSituations.ts` responde para ICMS/PIS/COFINS/IPI ("o
 *    grupo XML deste CST tem onde escrever estes campos?"), com a diferença de
 *    que aqui a resposta é **publicada** em vez de lida do leiaute.
 * 2. **Tabela de Classificação Tributária (`cClassTrib`)** — 164 códigos, cada
 *    um com o `pRedIBS` e o `pRedCBS` que o art. 348, III, "a", manda aplicar,
 *    o CST a que pertence e os modelos de DF-e em que vale.
 *
 * **Por que tabela fixa no código e não cadastro novo no banco** (a decisão que
 * a entrada de B10 no AGENTS.md registra por extenso): as duas são catálogo
 * público e oficial, como CFOP e NCM — que este sistema importou por migration
 * —, e não tabela licenciada por usuário como a do IBPT, que virou o cadastro
 * `ibpt_rates` de B9. Mais importante: o `pRedAliq` **não é decisão de quem
 * opera o sistema**, é função do `cClassTrib` que ele já digita em Grupos
 * tributários — e a `UB27-10` confere justamente essa correspondência
 * (rejeição 1034). Pedir o percentual ao contador seria criar um campo cuja
 * única resposta certa já está publicada, e cujo erro de digitação a SEFAZ
 * rejeita.
 *
 * O preço dessa escolha é o de toda tabela fixa: ela **envelhece**. O Informe
 * Técnico é revisado (v1.00 em 19/05/2025, v1.60 em 23/06/2026), e um
 * `cClassTrib` novo publicado depois desta data será recusado aqui como
 * inexistente até alguém atualizar o bloco. Está registrado no AGENTS.md como
 * a manutenção que esta tarefa cria.
 */

import { regimeOptantePeloSimples } from "./taxSituations.ts";

/** Modelo do documento fiscal, como a coluna `indNFe`/`indNFCe` da tabela oficial o nomeia. */
export type ModeloDocumentoFiscal = "55" | "65";

/** As três alíquotas padrão de um ano, em percentual. */
export type AliquotasPadraoIbsCbs = {
  /** `pIBSUF` — alíquota do IBS de competência das Unidades Federadas. */
  ibsUf: number;
  /** `pIBSMun` — alíquota do IBS de competência do Município. */
  ibsMun: number;
  /** `pCBS` — alíquota da CBS. */
  cbs: number;
};

/**
 * Alíquotas padrão por ano de emissão do documento, exatamente como as regras
 * `UB18-10`, `UB37-10` e `UB56-10` da NT 2025.002-RTC as conferem.
 *
 * **Só existem 2025 e 2026 aqui, e isso é deliberado.** O art. 344 fixa
 * 0,05% + 0,05% de IBS para 2027 e 2028, mas o art. 347 remete a alíquota da
 * CBS desses anos à referência que resolução do Senado Federal ainda vai
 * publicar ("aquela fixada nos termos do inciso I do caput e dos §§ 2º e 3º
 * […] do art. 14, reduzida em 0,1 ponto percentual"). Inventar esse número
 * seria exatamente o que este motor não faz — então 2027 em diante **recusa a
 * emissão** com mensagem própria, e a tarefa de estender esta tabela nasce
 * datada. Ver `resolveAliquotasPadraoIbsCbs`.
 */
const ALIQUOTAS_PADRAO: Record<string, AliquotasPadraoIbsCbs> = {
  // "0,1% para documento com data de emissão no ano de 2025 e 2026" (UB18-10),
  // "0% […] no ano de 2025 e 2026" (UB37-10), "0,9% […] no ano de 2025 e 2026"
  // (UB56-10). O ano de 2025 está aqui porque as regras o citam — na prática
  // este sistema não emite nota com data anterior a 2026.
  "2025": { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 },
  "2026": { ibsUf: 0.1, ibsMun: 0, cbs: 0.9 },
};

/** O primeiro ano em que o leiaute aceita o grupo — antes dele o campo nem existia no schema. */
const PRIMEIRO_ANO_COM_GRUPO = 2025;

export type AliquotasPadraoResolution =
  /** O documento declara o grupo, com estas alíquotas nominais. */
  | { situacao: "declara"; aliquotas: AliquotasPadraoIbsCbs }
  /** Documento anterior ao leiaute do IBS/CBS — não declara, e isso não é erro. */
  | { situacao: "anterior_ao_grupo" }
  /** Emitente optante pelo Simples Nacional — art. 348, III, "c". Não declara. */
  | { situacao: "simples_nacional" }
  /** Ano cujas alíquotas ainda não foram publicadas — recusa, com este motivo. */
  | { situacao: "sem_aliquota_publicada"; reason: string };

/** Ano de emissão a partir de uma data ISO `YYYY-MM-DD` (o formato de `sales.issue_date`). */
function anoDeEmissao(issueDate: string): number {
  return Number.parseInt(issueDate.slice(0, 4), 10);
}

/**
 * Este documento declara IBS/CBS? E, se declara, com que alíquotas nominais?
 *
 * Duas dimensões, as duas **do documento** e não do item: o regime de quem
 * emite (art. 348, III, "c") e o ano de emissão (arts. 343/346 e as regras
 * `UB18-10`/`UB37-10`/`UB56-10`). Nenhuma das duas depende do produto — é por
 * isso que esta função roda uma vez por nota, fora do laço de itens.
 */
export function resolveAliquotasPadraoIbsCbs(
  issueDate: string,
  regimeTributario: string | null | undefined,
): AliquotasPadraoResolution {
  // Art. 348, III, "c", e o cronograma da NT: CRT 1, 2 e 4 só entram em 2027.
  if (regimeOptantePeloSimples(regimeTributario)) return { situacao: "simples_nacional" };

  const ano = anoDeEmissao(issueDate);
  if (!Number.isFinite(ano) || ano < PRIMEIRO_ANO_COM_GRUPO) return { situacao: "anterior_ao_grupo" };

  const aliquotas = ALIQUOTAS_PADRAO[String(ano)];
  if (aliquotas) return { situacao: "declara", aliquotas };

  return {
    situacao: "sem_aliquota_publicada",
    reason:
      `as alíquotas padrão de IBS/CBS de ${ano} ainda não estão neste motor — a de IBS está no ` +
      `art. 344 da LC 214/2025 (0,05% estadual + 0,05% municipal), mas a da CBS depende de ` +
      `resolução do Senado Federal (art. 347). Atualize ALIQUOTAS_PADRAO em ibsCbs.ts.`,
  };
}

/**
 * Uma linha da tabela CST do IBS/CBS:
 * `[ind_gIBSCBS, ind_gRed, grupo do leiaute que este motor não monta]`.
 *
 * - **`ind_gIBSCBS`** — "Indica se deve ser preenchido o grupo de informações
 *   padrão do IBS e da CBS no documento fiscal". Quando é `false`, o item
 *   declara **só** `CST` e `cClassTrib`, e mandar `gIBSCBS` é a rejeição 1021
 *   (`UB13-20`); quando é `true`, **não** mandar é a rejeição 1022 (`UB13-30`).
 * - **`ind_gRed`** — "Indica se há necessidade de informar os grupos de redução
 *   de alíquota do IBS e da CBS". Quando é `true`, os **três** grupos
 *   (`gIBSUF`, `gIBSMun` e `gCBS`) exigem o `gRed` — rejeições 1033
 *   (`UB26-20`), 1074 (`UB45-20`) e 1079 (`UB64-20`) —, **inclusive o
 *   municipal, cuja alíquota é zero em 2026**. A versão 1.33 da NT chegou a
 *   condicionar o `gRed` a "alíquota maior que zero" e a 1.34 desabilitou essa
 *   condição (regras `UB26-15`/`UB45-15`/`UB64-15`); vale a regra sem exceção.
 * - **terceiro elemento** — o nome do grupo que aquele CST exige e que B10 não
 *   monta. Não é indicador da tabela: é a tradução dos outros indicadores dela
 *   (`ind_gIBSCBSMono`, `ind_RedutorBC`, `ind_gDif`, `ind_gTransfCred`,
 *   `ind_gCredPresIBSZFM`, `ind_gAjusteCompet`) para uma frase que a recusa
 *   consegue mostrar. `null` = o CST cabe inteiro no que esta tarefa faz.
 */
type LinhaCst = readonly [declaraGrupo: boolean, exigeReducao: boolean, grupoNaoImplementado: string | null];

/** Tabela CST do IBS/CBS — Informe Técnico 2025.002 v.1.60 (23/06/2026), 18 códigos. */
const SITUACOES_TRIBUTARIAS: Record<string, LinhaCst> = {
  "000": [true, false, null], // Tributação integral
  "010": [true, false, null], // Tributação com alíquotas uniformes
  "011": [true, true, null], // Tributação com alíquotas uniformes reduzidas
  "200": [true, true, null], // Alíquota reduzida
  "220": [true, false, null], // Alíquota fixa
  "221": [true, false, null], // Alíquota fixa proporcional
  "222": [true, false, "redutor da base de cálculo (ind_RedutorBC)"], // Redução de Base de Cálculo
  "400": [false, false, null], // Isenção
  "410": [false, false, null], // Imunidade e não incidência
  "510": [true, false, "gDif (diferimento)"], // Diferimento
  "515": [true, true, "gDif (diferimento)"], // Diferimento com redução de alíquota
  "550": [true, false, null], // Suspensão
  "620": [false, false, "gIBSCBSMono (tributação monofásica)"], // Tributação Monofásica
  "800": [false, false, "gTransfCred (transferência de crédito)"], // Transferência de crédito
  "810": [false, false, "gCredPresIBSZFM (crédito presumido de IBS na ZFM)"], // Ajuste de IBS na ZFM
  "811": [false, false, "gAjusteCompet (ajuste por competência)"], // Ajustes
  "820": [false, false, null], // Tributação em documento específico
  "830": [true, false, null], // Exclusão da Base de Cálculo
};

/**
 * Uma linha da tabela de Classificação Tributária:
 * `[pRedIBS, pRedCBS, modelos de DF-e, "regular"?]`.
 *
 * - **`pRedIBS` / `pRedCBS`** — "Percentual de redução da alíquota do IBS
 *   associado ao código informado em cClassTrib" e o correspondente da CBS,
 *   nas palavras do próprio Informe Técnico. São **duas** colunas porque podem
 *   divergir: na tabela de hoje só o `200025` diverge (60% de IBS contra 100%
 *   de CBS), e um único caso já basta para não colapsar as duas.
 * - **modelos** — `"55"`, `"65"`, `"55,65"` ou `""`, transcrevendo `indNFe` e
 *   `indNFCe`. Código válido só para outro DF-e (NFS-e, CT-e, NF3e…) tem `""`
 *   e é recusado com mensagem própria: mandá-lo é a rejeição 1025
 *   (`UB14-25`).
 * - **`"regular"`** — o indicador `ind_gTribRegular`, que **exige** o grupo
 *   `gTribRegular` (rejeição 1065, `UB68-10`) e ainda zera as alíquotas
 *   nominais (exceção 1 das `UB18-10`/`UB56-10`). São 27 códigos — os 25 de
 *   suspensão (CST 550) mais o `200022` e o `200024` —, todos recusados por
 *   este motor: o grupo carrega a tributação que *seria* devida e não há de
 *   onde tirá-la aqui.
 */
type LinhaCClassTrib =
  | readonly [reducaoIbs: number, reducaoCbs: number, modelos: string]
  | readonly [reducaoIbs: number, reducaoCbs: number, modelos: string, tributacaoRegular: "regular"];

/**
 * Tabela de Classificação Tributária do IBS e da CBS — Informe Técnico
 * 2025.002 v.1.60 (23/06/2026), 164 códigos.
 *
 * O CST de cada código são **os três primeiros dígitos dele** (conferido para
 * os 164), então a tabela não repete essa coluna: `resolveIbsCbs` deriva o CST
 * do próprio `cClassTrib` e o compara com o cadastrado, que é a checagem da
 * `UB14-20` (rejeição 1024, "cClassTrib incompatível com CST").
 */
const CLASSIFICACOES_TRIBUTARIAS: Record<string, LinhaCClassTrib> = {
  "000001": [0, 0, "55,65"], // Situações tributadas integralmente pelo IBS e CBS
  "000002": [0, 0, ""], // Exploração de via
  "000003": [0, 0, "55"], // Regime automotivo - projetos incentivados (art. 311)
  "000004": [0, 0, "55"], // Regime automotivo - projetos incentivados (art. 312)
  "000005": [0, 0, "55"], // Operação com EAC destinado à mistura com gasolina A, mas com saída do...
  "010001": [0, 0, ""], // Operações do FGTS não realizadas pela Caixa Econômica Federal
  "010002": [0, 0, ""], // Operações do serviço financeiro
  "011001": [60, 60, ""], // Planos de assistência funerária
  "011002": [60, 60, ""], // Planos de assistência à saúde
  "011003": [60, 60, ""], // Intermediação de planos de assistência à saúde
  "011004": [0, 0, ""], // Concursos e prognósticos
  "011005": [30, 30, ""], // Planos de assistência à saúde de animais domésticos
  "200001": [100, 100, ""], // Serviços de transporte de bens até as zonas de processamento de expor...
  "200002": [100, 100, "55,65"], // Fornecimento ou importação para produtor rural não contribuinte ou TAC
  "200003": [100, 100, "55,65"], // Vendas de produtos destinados à alimentação humana (Anexo I)
  "200004": [100, 100, "55,65"], // Fornecimento de dispositivos médicos (Anexo XII)
  "200005": [100, 100, "55"], // Fornecimento de dispositivos médicos para órgãos da administração púb...
  "200006": [100, 100, "55,65"], // Situação de emergência de saúde pública reconhecida pelo Poder público
  "200007": [100, 100, "55,65"], // Fornecimento dos dispositivos de acessibilidade próprios para pessoas...
  "200008": [100, 100, "55"], // Fornecimento dos dispositivos de acessibilidade próprios para pessoas...
  "200009": [100, 100, "55,65"], // Fornecimento dos medicamentos registrados na Anvisa
  "200010": [100, 100, "55,65"], // Fornecimento dos medicamentos registrados na Anvisa, adquiridos por ó...
  "200011": [100, 100, "55"], // Fornecimento das composições para nutrição enteral e parenteral quand...
  "200012": [100, 100, "55,65"], // Situação de emergência de saúde pública reconhecida pelo Poder público
  "200013": [100, 100, "55,65"], // Fornecimento de tampões higiênicos, absorventes higiênicos internos o...
  "200014": [100, 100, "55,65"], // Fornecimento dos produtos hortícolas, frutas e ovos (Anexo XV)
  "200015": [100, 100, "55,65"], // Venda de automóveis de passageiros de fabricação nacional adquiridos ...
  "200016": [100, 100, ""], // Prestação de serviços de pesquisa e desenvolvimento por Instituição C...
  "200017": [100, 100, ""], // Operações relacionadas ao FGTS
  "200018": [100, 100, ""], // Operações de resseguro e retrocessão
  "200019": [100, 100, ""], // Importador dos serviços financeiros contribuinte
  "200020": [100, 100, "55,65"], // Operação praticada por sociedades cooperativas optantes por regime es...
  "200021": [100, 100, ""], // Serviços de transporte público coletivo de passageiros ferroviário e ...
  "200022": [100, 100, "55", "regular"], // Operação originada fora da ZFM que destine bem material industrializa...
  "200023": [100, 100, "55"], // Operação realizada por indústria incentivada que destine bem material...
  "200024": [100, 100, "55", "regular"], // Operação originada fora das Áreas de Livre Comércio destinadas a cont...
  "200025": [60, 100, ""], // Fornecimento dos serviços de educação relacionados ao Programa Univer...
  "200026": [80, 80, ""], // Locação de imóveis localizados nas zonas reabilitadas
  "200027": [70, 70, ""], // Operações de locação, cessão onerosa e arrendamento de bens imóveis
  "200028": [60, 60, ""], // Fornecimento dos serviços de educação (Anexo II)
  "200029": [60, 60, ""], // Fornecimento dos serviços de saúde humana (Anexo III)
  "200030": [60, 60, "55,65"], // Venda dos dispositivos médicos (Anexo IV)
  "200031": [60, 60, "55,65"], // Fornecimento dos dispositivos de acessibilidade próprios para pessoas...
  "200032": [60, 60, "55,65"], // Fornecimento dos medicamentos registrados na Anvisa ou produzidos por...
  "200033": [60, 60, "55,65"], // Fornecimento das composições para nutrição enteral e parenteral (Anex...
  "200034": [60, 60, "55,65"], // Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)
  "200035": [60, 60, "55,65"], // Fornecimento dos produtos de higiene pessoal e limpeza (Anexo VIII)
  "200036": [60, 60, "55,65"], // Fornecimento de produtos agropecuários, aquícolas, pesqueiros, flores...
  "200037": [60, 60, ""], // Fornecimento de serviços ambientais de conservação ou recuperação da ...
  "200038": [60, 60, "55,65"], // Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)
  "200039": [60, 60, "55"], // Fornecimento dos bens e serviços relacionados com produções nacionais...
  "200040": [60, 60, ""], // Fornecimento de serviços de comunicação institucional à administração...
  "200041": [60, 60, ""], // Fornecimento de serviço de educação desportiva (art. 141. I)
  "200042": [60, 60, ""], // Fornecimento de serviço de gestão e exploração do desporto (art. 141....
  "200043": [60, 60, "55"], // Fornecimento à administração pública dos serviços e dos bens relativo...
  "200044": [60, 60, ""], // Operações e prestações de serviços de segurança da informação e segur...
  "200045": [60, 60, ""], // Operações relacionadas a projetos de reabilitação urbana de zonas his...
  "200046": [50, 50, ""], // Operações com bens imóveis
  "200047": [40, 40, "55,65"], // Bares e Restaurantes
  "200048": [40, 40, ""], // Hotelaria, Parques de Diversão e Parques Temáticos
  "200049": [40, 40, ""], // Transporte coletivo de passageiros rodoviário, ferroviário e hidroviário
  "200050": [40, 40, ""], // Serviços de transporte aéreo regional coletivo de passageiros ou de c...
  "200051": [40, 40, ""], // Agências de Turismo
  "200052": [30, 30, ""], // Prestação de serviços de profissões intelectuais
  "200053": [100, 100, "55,65"], // Fornecimento de medicamentos registrados na Anvisa, quando classifica...
  "200054": [100, 100, "55,65"], // Fornecimento de bem material pela cooperativa de produção agropecuári...
  "220001": [0, 0, ""], // Incorporação imobiliária submetida ao regime especial de tributação
  "220002": [0, 0, ""], // Incorporação imobiliária submetida ao regime especial de tributação
  "220003": [0, 0, ""], // Alienação de imóvel decorrente de parcelamento do solo
  "221001": [0, 0, ""], // Locação, cessão onerosa ou arrendamento de bem imóvel com alíquota so...
  "221002": [0, 0, ""], // Incorporação imobiliária submetida ao regime especial de tributação
  "221003": [0, 0, ""], // Incorporação imobiliária submetida ao regime especial de tributação
  "221004": [0, 0, ""], // Alienação de imóvel decorrente de parcelamento do solo
  "222001": [0, 0, ""], // Transporte internacional de passageiros, caso os trechos de ida e vol...
  "400001": [0, 0, ""], // Fornecimento de serviços de transporte público coletivo de passageiro...
  "400002": [0, 0, ""], // Fornecimento de serviços de transporte público coletivo de passageiro...
  "410001": [0, 0, "55,65"], // Fornecimento de bonificações quando constem no documento fiscal e que...
  "410002": [0, 0, "55"], // Transferências entre estabelecimentos pertencentes ao mesmo contribuinte
  "410003": [0, 0, "55,65"], // Doações sem contraprestação em benefício do doador
  "410004": [0, 0, "55"], // Exportações de bens e serviços
  "410005": [0, 0, "55,65"], // Fornecimentos realizados pela União, pelos Estados, pelo Distrito Fed...
  "410006": [0, 0, "55,65"], // Fornecimentos realizados por entidades religiosas e templos de qualqu...
  "410007": [0, 0, "55,65"], // Fornecimentos realizados por partidos políticos, entidades sindicais ...
  "410008": [0, 0, "55,65"], // Fornecimentos de livros, jornais, periódicos e do papel destinado a s...
  "410009": [0, 0, "55,65"], // Fornecimentos de fonogramas e videofonogramas musicais produzidos no ...
  "410010": [0, 0, ""], // Fornecimentos de serviço de comunicação nas modalidades de radiodifus...
  "410011": [0, 0, ""], // Fornecimentos de ouro, quando definido em lei como ativo financeiro o...
  "410012": [0, 0, "55,65"], // Fornecimento de condomínio edilício não optante pelo regime regular
  "410013": [0, 0, "55"], // Exportações de combustíveis
  "410014": [0, 0, "55,65"], // Fornecimento de produtor rural não contribuinte
  "410015": [0, 0, ""], // Fornecimento por transportador autônomo não contribuinte
  "410016": [0, 0, "55"], // Fornecimento ou aquisição de resíduos sólidos
  "410017": [0, 0, "55"], // Aquisição de bem móvel com crédito presumido sob condição de revenda ...
  "410018": [0, 0, ""], // Operações relacionadas aos fundos garantidores e executores de políti...
  "410019": [0, 0, "55,65"], // Exclusão da gorjeta na base de cálculo no fornecimento de alimentação
  "410020": [0, 0, "55,65"], // Exclusão do valor de intermediação na base de cálculo no fornecimento...
  "410021": [0, 0, ""], // Contribuição de que trata o art. 149-A da Constituição Federal
  "410022": [0, 0, ""], // Consolidação da propriedade do bem pelo credor
  "410023": [0, 0, ""], // Alienação de bens móveis ou imóveis que tenham sido objeto de garanti...
  "410024": [0, 0, ""], // Consolidação da propriedade do bem pelo grupo de consórcio
  "410025": [0, 0, ""], // Alienação de bem que tenha sido objeto de garantia em que o prestador...
  "410026": [0, 0, "55,65"], // Doação com anulação de crédito
  "410027": [0, 0, "55"], // Exportação de serviço ou de bem imaterial
  "410028": [0, 0, ""], // Operações com bens imóveis realizadas por pessoas físicas não conside...
  "410029": [0, 0, "55,65"], // Operações acobertadas somente pelo ICMS
  "410030": [0, 0, "55"], // Estorno de crédito por perecimento, deteriorização, roubo, furto ou e...
  "410031": [0, 0, "55"], // Fornecimento em período anterior ao início de vigência de incidências...
  "410032": [0, 0, ""], // Tributos incidentes na operação que não integram a base de cálculo do...
  "410033": [0, 0, ""], // Operações de Fundos de Investimento Imobiliário (FII) e Fundos de Inv...
  "410034": [0, 0, ""], // Operações de fundos de investimento
  "410035": [0, 0, "55,65"], // Fornecimento realizado por nanoempreendedor
  "410036": [0, 0, ""], // Descontos incondicionais
  "410037": [0, 0, ""], // Importação de bens materiais sem incidência de IBS e CBS
  "410999": [0, 0, "55,65"], // Operações não onerosas sem previsão de tributação, não especificadas ...
  "510001": [0, 0, "55"], // Operações, sujeitas a diferimento, com energia elétrica, relativas à ...
  "515001": [60, 60, "55"], // Operações, sujeitas a diferimento, com insumos agropecuários e aquíco...
  "550001": [0, 0, "55", "regular"], // Exportações de bens materiais
  "550002": [0, 0, "55", "regular"], // Regime de Trânsito
  "550003": [0, 0, "55", "regular"], // Regimes de Depósito (art. 85)
  "550004": [0, 0, "55", "regular"], // Regimes de Depósito (art. 87)
  "550005": [0, 0, "55", "regular"], // Regimes de Depósito (art. 87, Parágrafo único)
  "550006": [0, 0, "55", "regular"], // Regimes de Permanência Temporária
  "550007": [0, 0, "55", "regular"], // Regimes de Aperfeiçoamento
  "550008": [0, 0, "55", "regular"], // Importação de bens para o Regime de Repetro-Temporário
  "550009": [0, 0, "55", "regular"], // GNL-Temporário
  "550010": [0, 0, "55", "regular"], // Repetro-Permanente
  "550011": [0, 0, "55", "regular"], // Repetro-Industrialização
  "550012": [0, 0, "55", "regular"], // Repetro-Nacional
  "550013": [0, 0, "55", "regular"], // Repetro-Entreposto
  "550014": [0, 0, "55", "regular"], // Zona de Processamento de Exportação
  "550015": [0, 0, "55", "regular"], // Regime Tributário para Incentivo à Modernização e à Ampliação da Estr...
  "550016": [0, 0, "55", "regular"], // Regime Especial de Incentivos para o Desenvolvimento da Infraestrutura
  "550017": [0, 0, "55", "regular"], // Regime Tributário para Incentivo à Atividade Econômica Naval
  "550018": [0, 0, "55", "regular"], // Desoneração da aquisição de bens de capital
  "550019": [0, 0, "55", "regular"], // Importação de bem material por indústria incentivada para utilização ...
  "550020": [0, 0, "55", "regular"], // Áreas de livre comércio
  "550021": [0, 0, "55", "regular"], // Industrialização destinada a exportações
  "550022": [0, 0, "55", "regular"], // Regime Especial de Incentivos para a Produção de Hidrogênio de Baixa ...
  "550023": [0, 0, "55", "regular"], // Operações com hidrocarbonetos líquidos derivados de petróleo não comb...
  "550024": [0, 0, "", "regular"], // Regime Tributário para Incentivo à Atividade Naval - Renaval (Art. 10...
  "550025": [0, 0, "", "regular"], // Regime Tributário para Incentivo à Atividade Naval - Renaval (Art. 10...
  "620001": [0, 0, "55"], // Tributação monofásica sobre combustíveis
  "620002": [0, 0, "55"], // Tributação monofásica com responsabilidade pela retenção sobre combus...
  "620003": [0, 0, "55"], // Tributação monofásica com responsabilidade de retenção de tributos po...
  "620004": [0, 0, "55"], // Tributação monofásica sobre mistura de EAC com gasolina A em percentu...
  "620005": [0, 0, "55"], // Tributação monofásica sobre mistura de EAC com gasolina A em percentu...
  "620006": [0, 0, "55,65"], // Tributação monofásica sobre combustíveis cobrada anteriormente
  "620007": [0, 0, "55"], // Perecimento, deteriorização, roubo, furto ou extravio no regime monof...
  "800001": [0, 0, "55"], // Fusão, cisão ou incorporação
  "800002": [0, 0, "55"], // Transferência de crédito do associado, inclusive as cooperativas sing...
  "810001": [0, 0, "55"], // Crédito presumido sobre o valor apurado nos fornecimentos a partir da...
  "811001": [0, 0, "55"], // Anulação de Crédito por Saídas Imunes/Isentas
  "811002": [0, 0, "55"], // Débitos de notas fiscais não processadas na apuração
  "811003": [0, 0, "55"], // Desenquadramento do Simples Nacional
  "820001": [0, 0, ""], // Documento com informações de fornecimento de serviços de planos de as...
  "820002": [0, 0, ""], // Documento com informações de fornecimento de serviços de planos de as...
  "820003": [0, 0, ""], // Documento com informações de fornecimento de serviços de planos de as...
  "820004": [0, 0, ""], // Documento com informações de prestação de serviços de consursos de pr...
  "820005": [0, 0, ""], // Documento com informações de alienação de bens imóveis
  "820006": [0, 0, ""], // Documento com informações de fornecimento de serviços de exploração d...
  "820007": [0, 0, ""], // Documento com informações de fornecimento de serviços financeiros
  "820008": [0, 0, ""], // Documento com informações de fornecimento de serviço continuado, mas ...
  "820009": [0, 0, ""], // Cobrança relativa a fornecimentos declarados em outro documento
  "830001": [0, 0, "55"], // Documento com exclusão da BC da CBS e do IBS de energia elétrica forn...
};

/** Tira espaço de digitação. Não completa zeros à esquerda — os códigos têm largura fixa. */
function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim();
}

/**
 * `pAliqEfet` — a alíquota efetiva depois da redução, com **4 casas decimais**.
 *
 * A conta é a da `UB28-10` (rejeição 1035): `pAliqEfet = pIBSUF × (1 −
 * pRedAliq / 100)`, com a observação "o cálculo da pAliqEfet deve considerar 4
 * casas decimais, com arredondamento na última casa decimal". As regras
 * `UB47-10` (municipal) e `UB66-10` (CBS) repetem a mesma fórmula sobre as
 * alíquotas delas.
 *
 * O fator de compra governamental (`gCompraGov/pRedutor`), que a mesma regra
 * prevê como segundo multiplicador, não entra: este motor não emite o grupo
 * `gCompraGov` — ver a limitação registrada no AGENTS.md.
 */
export function aliquotaEfetivaIbsCbs(aliquotaNominal: number, percentualReducao: number): number {
  return Math.round(aliquotaNominal * (1 - percentualReducao / 100) * 10000) / 10000;
}

/** O que o item declara depois de resolvido o cadastro de IBS/CBS. */
export type IbsCbsDeclarado = {
  /** `CST` (id `UB13`) — sempre presente quando o grupo `IBSCBS` sai. */
  situacaoTributaria: string;
  /** `cClassTrib` (id `UB14`) — idem. */
  classificacaoTributaria: string;
  /**
   * `gIBSCBS` sai? `false` nos CST com `ind_gIBSCBS = 0` (isenção `400`,
   * imunidade `410`…), em que o item declara só os dois códigos acima.
   */
  declaraGrupo: boolean;
  /** `pIBSUF` nominal — ausente quando `declaraGrupo` é `false`. */
  aliquotaIbsUf?: number;
  /** `pIBSMun` nominal. */
  aliquotaIbsMun?: number;
  /** `pCBS` nominal. */
  aliquotaCbs?: number;
  /**
   * `pRedAliq` do IBS (grupos `gIBSUF/gRed` e `gIBSMun/gRed`) — presente só nos
   * CST com `ind_gRed = 1`. `undefined` significa "este CST não tem `gRed`",
   * nunca "redução de zero": um `gRed` indevido é a rejeição 1032/1007.
   */
  reducaoIbs?: number;
  /** `pRedAliq` da CBS (grupo `gCBS/gRed`). Ver `reducaoIbs`. */
  reducaoCbs?: number;
  /** `pAliqEfet` do `gIBSUF/gRed`. */
  aliquotaEfetivaIbsUf?: number;
  /** `pAliqEfet` do `gIBSMun/gRed`. */
  aliquotaEfetivaIbsMun?: number;
  /** `pAliqEfet` do `gCBS/gRed`. */
  aliquotaEfetivaCbs?: number;
};

export type IbsCbsResolution = { ok: true; declarado: IbsCbsDeclarado } | { ok: false; reason: string };

/**
 * Resolve o cadastro de IBS/CBS de um item — o CST, o `cClassTrib` e a redução
 * de alíquota que os dois implicam.
 *
 * **Toda saída que não é `ok` recusa a emissão**, sem exceção, pelo motivo
 * explicado no cabeçalho deste arquivo: desde 03/08/2026 a NF-e/NFC-e de
 * Regime Normal sem o grupo `IBSCBS` é rejeitada (1115). Cada mensagem cita o
 * grupo tributário pelo nome, porque é lá que o contador conserta.
 *
 * A ordem das checagens segue a das regras de validação da NT, de fora para
 * dentro: existe o CST (`UB13-10`), existe o `cClassTrib` (`UB14-10`), eles
 * combinam (`UB14-20`), o código vale neste modelo (`UB14-25`) e, por fim, o
 * que o par exige do leiaute cabe no que este motor monta.
 */
export function resolveIbsCbs(input: {
  /** Nome do grupo tributário, para a mensagem de recusa. */
  nomeDoGrupo: string;
  /** `tax_groups.cst_ibs_cbs`. */
  cst: string | null;
  /** `tax_groups.cclasstrib`. */
  cclasstrib: string | null;
  /** As alíquotas nominais do ano, já resolvidas por `resolveAliquotasPadraoIbsCbs`. */
  aliquotas: AliquotasPadraoIbsCbs;
  modelo: ModeloDocumentoFiscal;
}): IbsCbsResolution {
  const { nomeDoGrupo, aliquotas, modelo } = input;
  const cst = normalizeCode(input.cst);
  const cclasstrib = normalizeCode(input.cclasstrib);

  const completeOCadastro = "Complete o cadastro em Grupos tributários.";

  if (!cst) {
    return {
      ok: false,
      reason:
        `o grupo tributário "${nomeDoGrupo}" não tem CST de IBS/CBS cadastrado, e desde 03/08/2026 ` +
        `a nota sem o grupo IBS/CBS é rejeitada pela SEFAZ (rejeição 1115). ${completeOCadastro}`,
    };
  }
  const situacao = SITUACOES_TRIBUTARIAS[cst];
  if (!situacao) {
    return {
      ok: false,
      reason:
        `o CST de IBS/CBS "${cst}" do grupo tributário "${nomeDoGrupo}" não existe na tabela oficial ` +
        `(rejeição 1020). ${completeOCadastro}`,
    };
  }

  if (!cclasstrib) {
    return {
      ok: false,
      reason:
        `o grupo tributário "${nomeDoGrupo}" não tem cClassTrib cadastrado — ele é obrigatório junto ` +
        `do CST de IBS/CBS. ${completeOCadastro}`,
    };
  }
  const classificacao = CLASSIFICACOES_TRIBUTARIAS[cclasstrib];
  if (!classificacao) {
    return {
      ok: false,
      reason:
        `o cClassTrib "${cclasstrib}" do grupo tributário "${nomeDoGrupo}" não existe na tabela ` +
        `oficial (rejeição 1023). ${completeOCadastro}`,
    };
  }
  // `UB14-20` (rejeição 1024): o CST do código é o prefixo de três dígitos dele.
  if (cclasstrib.slice(0, 3) !== cst) {
    return {
      ok: false,
      reason:
        `o cClassTrib "${cclasstrib}" pertence ao CST ${cclasstrib.slice(0, 3)}, mas o grupo ` +
        `tributário "${nomeDoGrupo}" está cadastrado com o CST de IBS/CBS "${cst}" (rejeição 1024). ` +
        `${completeOCadastro}`,
    };
  }

  const [reducaoIbs, reducaoCbs, modelos, tributacaoRegular] = classificacao;

  // `UB14-25` (rejeição 1025): `indNFe = 0` para o modelo 55, `indNFCe = 0` para o 65.
  if (!modelos.split(",").includes(modelo)) {
    const nomeDoModelo = modelo === "55" ? "NF-e" : "NFC-e";
    return {
      ok: false,
      reason:
        `o cClassTrib "${cclasstrib}" do grupo tributário "${nomeDoGrupo}" não é permitido em ` +
        `${nomeDoModelo} (modelo ${modelo}) — rejeição 1025. ${completeOCadastro}`,
    };
  }

  if (tributacaoRegular) {
    return {
      ok: false,
      reason:
        `o cClassTrib "${cclasstrib}" exige o grupo de Tributação Regular (gTribRegular), que este ` +
        `sistema ainda não emite. Ver a entrada de B10 no AGENTS.md.`,
    };
  }
  if (situacao[2]) {
    return {
      ok: false,
      reason:
        `o CST de IBS/CBS "${cst}" exige o grupo ${situacao[2]}, que este sistema ainda não emite. ` +
        `Ver a entrada de B10 no AGENTS.md.`,
    };
  }

  const [declaraGrupo, exigeReducao] = situacao;
  if (!declaraGrupo) {
    // Isenção (400), imunidade (410) e afins: só os dois códigos, e mandar
    // `gIBSCBS` aqui é a rejeição 1021.
    return {
      ok: true,
      declarado: { situacaoTributaria: cst, classificacaoTributaria: cclasstrib, declaraGrupo: false },
    };
  }

  const declarado: IbsCbsDeclarado = {
    situacaoTributaria: cst,
    classificacaoTributaria: cclasstrib,
    declaraGrupo: true,
    aliquotaIbsUf: aliquotas.ibsUf,
    aliquotaIbsMun: aliquotas.ibsMun,
    aliquotaCbs: aliquotas.cbs,
  };

  if (exigeReducao) {
    declarado.reducaoIbs = reducaoIbs;
    declarado.reducaoCbs = reducaoCbs;
    declarado.aliquotaEfetivaIbsUf = aliquotaEfetivaIbsCbs(aliquotas.ibsUf, reducaoIbs);
    declarado.aliquotaEfetivaIbsMun = aliquotaEfetivaIbsCbs(aliquotas.ibsMun, reducaoIbs);
    declarado.aliquotaEfetivaCbs = aliquotaEfetivaIbsCbs(aliquotas.cbs, reducaoCbs);
  }

  return { ok: true, declarado };
}

/**
 * A alíquota que **efetivamente** multiplica a base, para cada uma das três
 * parcelas: a efetiva quando há `gRed`, a nominal quando não há.
 *
 * É a observação 2 das regras `UB35-10`, `UB54-10` e `UB67-10`: "Em caso de
 * preenchimento do grupo de redução (gRed) a alíquota utilizada deverá ser a
 * tag Alíquota Efetiva (pAliqEfet) ao invés do pIBSUF".
 */
export function aliquotasAplicadasIbsCbs(declarado: IbsCbsDeclarado): {
  ibsUf: number;
  ibsMun: number;
  cbs: number;
} {
  return {
    ibsUf: declarado.aliquotaEfetivaIbsUf ?? declarado.aliquotaIbsUf ?? 0,
    ibsMun: declarado.aliquotaEfetivaIbsMun ?? declarado.aliquotaIbsMun ?? 0,
    cbs: declarado.aliquotaEfetivaCbs ?? declarado.aliquotaCbs ?? 0,
  };
}
