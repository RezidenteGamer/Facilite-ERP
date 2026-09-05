/**
 * Tipos de dado da emissão fiscal (NF-e / NFC-e) — payload de entrada e
 * resultados de saída. **O contrato em si (`FiscalProvider`) mora em
 * `./provider.ts`**, ao lado do erro que ele pode lançar.
 *
 * Mesmo papel que `ModuleDataRepository<T>` cumpre para dado de módulo: os
 * módulos que emitem nota (Notas Emitidas, NFC-e, Devolução) falam só com
 * esse contrato, nunca com um provedor concreto. Hoje a única implementação
 * completa é o `SimulatedFiscalProvider`, que não faz chamada de rede nenhuma;
 * `createFocusProvider()` já existe no mesmo contrato, mas ainda é esqueleto
 * (todos os métodos lançam `FiscalNotConfiguredError` até a tarefa A12).
 *
 * ## Por que este arquivo mora em `supabase/functions/_shared/fiscal/`
 *
 * Desde A2 (01/09/2026) o núcleo fiscal é compartilhado entre as duas bordas:
 * a Edge Function que emite (Deno, que exige a extensão `.ts` explícita nos
 * imports — daí `./types.ts` e não `./types`) e o front, que o consome pelo
 * alias `@fiscal-core` **só para prévia na tela, nunca para emitir**.
 * `src/lib/fiscal/*` continua existindo como camada fina de reexport, para
 * quem já importava de lá não quebrar.
 *
 * ## Por que o payload usa snake_case em português
 *
 * `NfePayload` reproduz **literalmente** o corpo JSON que a API da Focus NFe
 * espera (referência: https://doc.focusnfe.com.br/reference/emitir_nfe e a
 * tabela completa de campos em https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html).
 * Isso quebra a convenção camelCase do resto do projeto de propósito, e é a
 * decisão central desta etapa: a diferença entre o simulado e o real tem que
 * ser **transporte** (gerar localmente vs. um POST numa API), não **estrutura**.
 * Com os nomes iguais aos do provedor, o `emit` do provedor real é literalmente
 * um `JSON.stringify(payload)`; com nomes inventados agora, a troca depois
 * viraria reescrita de todo mundo que monta payload.
 *
 * Os nomes também não são invenção da Focus: são a tradução 1:1 do schema
 * oficial da NF-e da SEFAZ (grupos `ide`, `emit`, `dest`, `det`/`prod`/`imposto`,
 * `total`), que é o denominador comum de qualquer provedor sério. PlugNotas,
 * Nuvem Fiscal e NFe.io expõem os mesmos conceitos com grafias próprias — a
 * conversão para eles seria um mapa de nomes, não uma remodelagem.
 *
 * ## Por que o retorno NÃO usa snake_case
 *
 * O caminho inverso: o resultado é pequeno (uma dúzia de campos) e é o que os
 * nossos módulos guardam e exibem. Normalizar aqui custa uma função de adaptação
 * dentro do provedor real, e é justamente o que permite um segundo provedor
 * (com outros nomes de resposta) entrar sem tocar em Notas Emitidas. O nome
 * correspondente na Focus está anotado campo a campo abaixo.
 */

/** Modelo do documento: 55 = NF-e, 65 = NFC-e. Decide o endpoint no provedor real. */
export type FiscalModel = "nfe" | "nfce";

/**
 * Estados possíveis de um documento, com os mesmos nomes que a Focus usa.
 *
 * `processando_autorizacao` existe no tipo mesmo o simulado nunca devolvendo
 * esse valor: a emissão real é **assíncrona por padrão** (a API responde 202 e
 * a autorização sai depois, por consulta ou webhook). Deixar o estado de fora
 * faria os módulos nascerem sem tratar o caso mais comum do provedor real.
 */
export type FiscalStatus =
  | "processando_autorizacao"
  | "autorizado"
  | "cancelado"
  | "erro_autorizacao"
  | "denegado"
  | "nao_encontrado";

/** Estados possíveis de um pedido de cancelamento (resposta do DELETE na Focus). */
export type FiscalCancelStatus = "cancelado" | "erro_cancelamento" | "nao_encontrado";

/**
 * Estados possíveis dos **eventos que não são cancelamento** — carta de
 * correção e inutilização de faixa (A2, 01/09/2026).
 *
 * Vocabulário próprio, e não `FiscalCancelStatus` reaproveitado, porque
 * "cancelado" não descreve o que acontece nos dois: uma CC-e registrada não
 * cancela nada, e uma faixa inutilizada tampouco. `registrado` é o termo que a
 * própria SEFAZ usa no retorno dos dois eventos ("Evento registrado e vinculado
 * a NF-e" / "Inutilização de número homologada").
 */
export type FiscalEventStatus = "registrado" | "erro_evento" | "nao_encontrado";

/**
 * Um arquivo produzido pela emissão (XML da nota, DANFE/DANFCE, XML de
 * cancelamento).
 *
 * Os dois campos são excludentes e nomeiam exatamente a diferença de transporte:
 * o simulado **gera o conteúdo localmente** (`content` preenchido, `path` nulo);
 * a Focus **guarda o arquivo no servidor dela** e devolve o caminho de download
 * (`path` preenchido — `caminho_xml_nota_fiscal` / `caminho_danfe` —, `content`
 * nulo até alguém baixar). Quem exibe escreve um helper só, que serve os dois.
 */
export type FiscalArtifact = {
  content: string | null;
  path: string | null;
  contentType: string;
};

/**
 * O documento fiscal do ponto de vista de quem consome esta interface.
 * Entre parênteses, o campo correspondente na resposta da Focus.
 */
export type FiscalDocument = {
  /** Identificador gerado por nós (Focus: `ref`) — ver `FiscalEmitRequest.ref`. */
  ref: string;
  model: FiscalModel;
  status: FiscalStatus;
  /** Chave de acesso de 44 dígitos (Focus: `chave_nfe`). Nula enquanto não autorizada. */
  chave: string | null;
  /** Número sequencial da nota (Focus: `numero`). */
  numero: string | null;
  /** Série (Focus: `serie`). */
  serie: string | null;
  /** Protocolo de autorização da SEFAZ (Focus: `protocolo`). */
  protocolo: string | null;
  /** Código de retorno da SEFAZ, ex.: "100" (Focus: `status_sefaz`). */
  statusSefaz: string | null;
  /** Mensagem legível da SEFAZ (Focus: `mensagem_sefaz`). */
  mensagemSefaz: string | null;
  /** XML da nota autorizada (Focus: `caminho_xml_nota_fiscal`). */
  xml: FiscalArtifact | null;
  /** DANFE/DANFCE para impressão (Focus: `caminho_danfe`). */
  pdf: FiscalArtifact | null;
  /** XML do evento de cancelamento (Focus: `caminho_xml_cancelamento`). */
  xmlCancelamento: FiscalArtifact | null;
  /**
   * URL de consulta do QR Code (Focus: `qrcode_url`) — **só existe para NFC-e**;
   * `null` em documentos NF-e. O CSC (Código de Segurança do Contribuinte) que
   * assina o QR Code **não é campo de payload nem de resposta**: no provedor
   * real ele é configurado por fora, por CNPJ+UF, direto no painel da Focus —
   * não viaja em `NfePayload` nem em `FiscalDocument` (confirmado contra a
   * documentação pública da Focus antes de desenhar este campo).
   */
  qrCodeUrl: string | null;
};

/**
 * Resultado de um cancelamento. Mais estreito que `FiscalDocument` de propósito:
 * é o que a Focus devolve no DELETE (status + retorno da SEFAZ + XML do evento),
 * sem repetir chave/número/protocolo que quem cancelou já tem em mãos.
 */
export type FiscalCancelResult = {
  ref: string;
  status: FiscalCancelStatus;
  statusSefaz: string | null;
  mensagemSefaz: string | null;
  xmlCancelamento: FiscalArtifact | null;
};

export type FiscalEmitRequest = {
  /**
   * Identificador da emissão **gerado por nós** e único para sempre (Focus: `ref`,
   * passado na query string do POST e usado como chave do GET e do DELETE).
   *
   * Este é o desvio mais importante em relação ao desenho de partida do plano,
   * que passava a `chave` para `cancel`/`query`. No provedor real a chave de
   * acesso **não serve como identificador**: ela só existe depois da autorização,
   * e uma emissão que ainda está processando (ou que falhou) não tem chave
   * nenhuma — mas precisa ser consultada do mesmo jeito. Manter `chave` como
   * chave de busca obrigaria o provedor real a manter um mapa chave→ref e
   * deixaria a consulta de nota em processamento sem resposta possível.
   */
  ref: string;
  model: FiscalModel;
  payload: NfePayload;
};

export type FiscalCancelRequest = {
  ref: string;
  /** Focus: `justificativa`, obrigatória, de 15 a 255 caracteres (regra da SEFAZ). */
  justificativa: string;
};

/**
 * Resultado de um evento que não é cancelamento: carta de correção e
 * inutilização de faixa (A2, 01/09/2026).
 *
 * Um tipo só para os dois, e não um por evento, porque o que volta é
 * literalmente o mesmo conjunto: o retorno da SEFAZ (código + mensagem), o
 * protocolo do evento, o número sequencial (quando o evento tem um) e o XML
 * do próprio evento. O que diferencia CC-e de inutilização está na
 * **requisição**, não na resposta — e é lá que os tipos divergem.
 */
export type FiscalEventResult = {
  /** A mesma `ref` da requisição — identifica o evento, não o documento. */
  ref: string;
  status: FiscalEventStatus;
  /** Código de retorno da SEFAZ, ex.: "135" (Focus: `status_sefaz`). */
  statusSefaz: string | null;
  mensagemSefaz: string | null;
  /** Protocolo do evento (Focus: `protocolo`). Nulo quando o evento foi recusado. */
  protocolo: string | null;
  /**
   * Número sequencial do evento — a CC-e é numerada de 1 a 20 por NF-e (regra
   * da SEFAZ), e é isso que distingue a terceira correção da primeira.
   * `null` na inutilização, que não é um evento *de um documento* e por isso
   * não tem sequência.
   */
  numeroSequencial: number | null;
  /** XML do evento (Focus: `caminho_xml_carta_correcao` / `caminho_xml`). */
  xml: FiscalArtifact | null;
};

/**
 * Carta de correção eletrônica (CC-e, evento 110110).
 *
 * Corrige erro que **não** altera valores, destinatário nem mercadoria — para
 * isso o caminho é cancelar ou emitir nota de devolução, não corrigir. A SEFAZ
 * exige texto de 15 a 1000 caracteres, e cada NF-e aceita no máximo 20 cartas;
 * a última substitui as anteriores.
 */
export type FiscalCorrectionRequest = {
  /** A `ref` do **documento** que está sendo corrigido (Focus: `{ref}` na URL). */
  ref: string;
  /** Focus: `correcao`. 15 a 1000 caracteres (regra da SEFAZ). */
  correcao: string;
};

/**
 * Inutilização de faixa de numeração (evento 110111 não — é um serviço
 * próprio, `nfeInutilizacao`).
 *
 * **Não é um evento de um documento**, e essa é a diferença que o tipo precisa
 * dizer sozinho: ela declara à SEFAZ que uma faixa de números de uma série
 * nunca foi (e nunca será) usada — tipicamente porque a emissão falhou e o
 * número ficou pelo caminho. Por isso identifica CNPJ + modelo + série + faixa,
 * e não uma `ref` de nota; a `ref` daqui é do **pedido**, gerada por nós, e é o
 * que torna o pedido idempotente igual à emissão.
 */
export type FiscalInvalidateRequest = {
  /** Identificador do pedido, gerado por nós — idempotência, igual à emissão. */
  ref: string;
  /** CNPJ do emitente (Focus: `cnpj`). */
  cnpj: string;
  /** 55 (NF-e) ou 65 (NFC-e) — a faixa é por modelo. */
  model: FiscalModel;
  /** Focus: `serie`. */
  serie: number;
  /** Focus: `numero_inicial`. */
  numeroInicial: number;
  /** Focus: `numero_final`. */
  numeroFinal: number;
  /** Focus: `justificativa`, de 15 a 255 caracteres (mesma regra do cancelamento). */
  justificativa: string;
};

/* ------------------------------------------------------------------------ */
/* Payload — espelho do corpo JSON da Focus NFe (v2)                         */
/* ------------------------------------------------------------------------ */

/**
 * Um item da nota (grupo `det`/`prod`/`imposto` do schema da SEFAZ).
 *
 * Os campos de **valor** de imposto (`icms_valor`, `pis_valor`, ...) são todos
 * opcionais porque quem os calcula é o módulo Tributações (etapa 7), que ainda
 * não existe. Ficam declarados aqui desde já para essa etapa ter onde gravar
 * sem mexer no tipo — esta etapa não sabe nada sobre alíquota.
 */
export type NfePayloadItem = {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  /** Vem de `sale_items.cfop`; quem decide o CFOP é Tributações. */
  cfop: string;
  /** `products.ncm`. */
  codigo_ncm: string;
  /** `products.cest`. */
  codigo_cest?: string;
  quantidade_comercial: number;
  valor_unitario_comercial: number;
  valor_bruto: number;
  /** `products.unidade_comercial`. */
  unidade_comercial?: string;
  quantidade_tributavel?: number;
  valor_unitario_tributavel?: number;
  /** `products.unidade_tributavel`. */
  unidade_tributavel?: string;
  valor_desconto?: number;
  valor_frete?: number;
  /** 1 = soma no total da nota, 0 = não soma. */
  inclui_no_total?: number;

  /** `products.origem_mercadoria` (0 a 8). */
  icms_origem: string;
  /** `products.cst_icms` **ou** `products.csosn`, conforme o regime da filial. */
  icms_situacao_tributaria: string;
  icms_modalidade_base_calculo?: string;
  /** `vBC` — **já reduzida** quando há `icms_reducao_base_calculo` (ver abaixo). */
  icms_base_calculo?: number;
  /**
   * `pRedBC` — o percentual de redução de base, em si (B1, 01/09/2026).
   *
   * O leiaute da NF-e pede **os dois**: `vBC` já reduzida *e* `pRedBC` com o
   * percentual que a reduziu, para o fisco conseguir refazer a conta a partir
   * do valor do produto. Por isso este campo existe além de `icms_base_calculo`
   * em vez de a redução ficar implícita na base. O nome é o que a Focus usa
   * (`icms_reducao_base_calculo`), confirmado na tabela de campos.
   *
   * Vai ausente quando não há redução — `pRedBC` não existe nos grupos `ICMS00`
   * e `ICMS10`, então mandar `0` seria inventar campo.
   */
  icms_reducao_base_calculo?: number;
  icms_aliquota?: number;
  icms_valor?: number;

  /* --- ICMS-ST (B2, 01/09/2026) --- */

  /**
   * `modBCST` — modalidade de determinação da base de cálculo do ICMS-ST.
   *
   * Este motor emite sempre `"4"` (Margem de Valor Agregado, em %), porque é a
   * única modalidade que ele sabe calcular: as outras (`0` preço tabelado, `1`
   * a `3` listas, `5` pauta, `6` valor da operação) são **valores** publicados
   * pelo estado, não uma margem, e exigiriam outra tabela de cadastro. As
   * regras 932/933 do validador amarram os dois campos: com `modBCST = 4` o
   * `pMVAST` é obrigatório, e com qualquer outra modalidade ele é proibido.
   */
  icms_modalidade_base_calculo_st?: string;
  /** `pMVAST` — a MVA **efetivamente usada**, já ajustada quando a operação é interestadual. */
  icms_margem_valor_adicionado_st?: number;
  /** `pRedBCST`. Nunca preenchido hoje — ver a entrada de B2 no AGENTS.md. */
  icms_reducao_base_calculo_st?: number;
  /** `vBCST` — base do próprio item majorada pela MVA. */
  icms_base_calculo_st?: number;
  /** `pICMSST` — a alíquota **interna do estado de destino** (hoje aproximada pela do grupo). */
  icms_aliquota_st?: number;
  /** `vICMSST` — (base ST × alíquota interna) − o ICMS próprio já destacado neste item. */
  icms_valor_st?: number;

  /* --- FCP retido por ST (B2, 01/09/2026) --- */

  /**
   * `vBCFCPST` — a base do FCP-ST, que é **a mesma base do ICMS-ST**.
   *
   * O FCP calculado aqui é sempre o **retido por substituição tributária**
   * (tags `*FCPST`), não o FCP da operação própria (`*FCP`): a alíquota vem de
   * `mva_rules`, que só é consultada quando o item tem ST.
   */
  fcp_base_calculo_st?: number;
  /** `pFCPST` — percentual do Fundo de Combate à Pobreza no estado de destino. */
  fcp_percentual_st?: number;
  /** `vFCPST`. */
  fcp_valor_st?: number;

  /* --- DIFAL da EC 87/2015: grupo `ICMSUFDest` (B4, 04/09/2026) --- */

  /**
   * `vBCUFDest` — a base de cálculo do ICMS devido à UF de **destino**.
   *
   * É **base única**: a cláusula segunda, §1º, do Convênio ICMS 236/2021 diz
   * que "a base de cálculo do imposto (…) é única e corresponde ao valor da
   * operação ou o preço do serviço, observado o art. 13 da Lei Complementar nº
   * 87, de 13 de setembro de 1996". Isto é: a mesma base que serve ao ICMS da
   * operação própria serve ao imposto devido ao destino — não há uma segunda
   * base a construir.
   *
   * Por isso este motor a preenche com o **mesmo número que alimenta o ICMS
   * próprio**: a base já reduzida quando o grupo tributário tem `pRedBC`
   * (o Convênio ICMS 153/2015 manda considerar redução de base e isenção no
   * cálculo do DIFAL, e o Convênio 236/2021 remete a ele), e o valor bruto do
   * item quando o CST/CSOSN não declara base própria (CST `30`/`60`, CSOSN).
   */
  icms_base_calculo_uf_destino?: number;
  /**
   * `vBCFCPUFDest` — a base do FCP devido à UF de destino, que é **a mesma**
   * `vBCUFDest`. Existe como campo próprio no leiaute (o FCP pode ter base
   * distinta em legislação estadual), e aqui acompanha a mesma decisão que B2
   * tomou para `fcp_base_calculo_st`.
   *
   * Ausente quando o NCM × UF de destino não tem FCP cadastrado — ausente é
   * "não calculado", nunca zero.
   */
  fcp_base_calculo_uf_destino?: number;
  /**
   * `pFCPUFDest` — percentual do Fundo de Combate à Pobreza da UF de destino.
   *
   * Vem de `mva_rules.fcp_aliquota`, a mesma coluna que B2 criou para o
   * `pFCPST`, e **é o mesmo número**: o percentual de FCP é do estado de
   * destino por NCM, e não muda conforme o imposto seja retido por
   * substituição tributária ou devido por diferencial de alíquota. O que muda
   * é a tag em que ele sai — `pFCPST` num caso, `pFCPUFDest` no outro.
   *
   * Este é o FCP da **operação própria**, que B2 não calculava: a parte de
   * `B3` que sobrou e virou carga de `B4`.
   */
  fcp_percentual_uf_destino?: number;
  /**
   * `pICMSUFDest` — a alíquota **interna** da UF de destino.
   *
   * Aproximada por `tax_groups.aliquota_icms`, a mesma proxy que B2 usa na
   * base do ICMS-ST, e com a mesma ressalva: não existe neste sistema uma
   * tabela de alíquota interna por UF × NCM. A ressalva pesa mais aqui — o
   * DIFAL *é* a diferença entre duas alíquotas —, e está registrada na entrada
   * de B4 no AGENTS.md como a lacuna de raiz do ICMS deste motor.
   */
  icms_aliquota_interna_uf_destino?: number;
  /**
   * `pICMSInter` — a alíquota interestadual da operação (4%, 7% ou 12%), a
   * mesma que `aliquotaInterestadual` já calcula desde B2 e que o `pICMS` do
   * item declara desde a correção de 04/09/2026. Sai também aqui porque o
   * fisco refaz a conta do grupo sem olhar o grupo vizinho.
   */
  icms_aliquota_interestadual?: number;
  /**
   * `pICMSInterPart` — o percentual do DIFAL que cabe à UF de destino.
   *
   * **Sempre `100`.** O art. 99 do ADCT escalonou a partilha entre origem e
   * destino (40% em 2016, 60% em 2017, 80% em 2018) e a encerrou em **100% a
   * partir de 2019**. O campo continua no leiaute e continua obrigatório no
   * grupo — o que acabou foi o escalonamento, não a tag.
   */
  icms_percentual_partilha?: number;
  /** `vFCPUFDest` — `vBCFCPUFDest × pFCPUFDest`. Ausente quando não há FCP cadastrado. */
  fcp_valor_uf_destino?: number;
  /**
   * `vICMSUFDest` — o DIFAL devido à UF de destino.
   *
   * A regra de validação **`NA15-10`** (rejeição **815**) confere
   * `vBCUFDest × (pICMSUFDest − pICMSInter) × pICMSInterPart`, e é essa a
   * conta que este motor faz. O FCP **não** entra nela: é campo próprio, com
   * conferência própria.
   */
  icms_valor_uf_destino?: number;
  /**
   * `vICMSUFRemet` — a parte do DIFAL que caberia à UF de **origem**.
   *
   * **Sempre `0`**, e presente de propósito: com `pICMSInterPart = 100` a
   * fatia da origem é `vBCUFDest × (pICMSUFDest − pICMSInter) × 0`. O campo
   * segue obrigatório no grupo (a `NA01-20` o lista entre os exigidos), então
   * zerado é diferente de ausente — omiti-lo seria rejeição de schema.
   */
  icms_valor_uf_remetente?: number;

  /* --- Crédito de ICMS do Simples Nacional (B8, 03/09/2026) --- */

  /**
   * `pCredSN` — a alíquota aplicável de cálculo do crédito do Simples Nacional,
   * em percentual. Vem de `branches.aliquota_credito_icms_simples`: é o
   * percentual efetivo de ICMS da faixa de RBT12 da **filial**, não um atributo
   * do produto (ver `resolveCreditoSimples` em `invoiceMapping.ts`).
   *
   * Sai **apenas** nos CSOSN `101` e `201`, onde os grupos `ICMSSN101`/
   * `ICMSSN201` o exigem (`S` na tabela de campos do leiaute 4.00). O grupo
   * `ICMSSN900` também o aceita, mas como opcional, e este motor não o declara
   * lá — ver `icmsCalculaCreditoSimples` em `taxSituations.ts`.
   */
  icms_aliquota_credito_simples?: number;
  /**
   * `vCredICMSSN` — o valor do crédito de ICMS que o destinatário pode
   * aproveitar nos termos do art. 23 da LC 123/2006.
   *
   * `valor bruto do item × pCredSN`. A base é o **valor da operação** e não uma
   * base de cálculo de ICMS: o grupo `ICMSSN101` não tem `vBC`, então nada
   * disso viaja no XML além do percentual e do valor.
   */
  icms_valor_credito_simples?: number;

  /** `tax_groups.cst_ipi`, com `products.cst_ipi` de fallback (ver `taxGroups.ts`). */
  ipi_situacao_tributaria?: string;
  ipi_base_calculo?: number;
  ipi_aliquota?: number;
  ipi_valor?: number;

  /** `tax_groups.cst_pis`. */
  pis_situacao_tributaria?: string;
  /** `vBC` do grupo `PISAliq`/`PISOutr` — só no caminho percentual. */
  pis_base_calculo?: number;
  /** `pPIS` — a alíquota em **porcentagem**. */
  pis_aliquota_porcentual?: number;

  /* --- PIS/COFINS por unidade de medida, grupo `PISQtde` (B5, 01/09/2026) --- */

  /**
   * `qBCProd` — a quantidade vendida que serve de base ao PIS ad rem (CST 03).
   *
   * Vai **no lugar** de `pis_base_calculo`/`pis_aliquota_porcentual`, nunca
   * junto: o grupo `PISQtde` do leiaute 4.00 não tem `vBC` nem `pPIS`, e o
   * `PISOutr` (CST 49–99) trata as duas formas como escolha exclusiva
   * (`xs:choice`) — mandar as quatro tags é rejeição de schema.
   *
   * **Sai na quantidade comercial do item.** O leiaute pede a quantidade na
   * unidade a que a lei prende a alíquota específica, e este sistema não tem
   * fator de conversão entre `products.unidade_comercial` e
   * `products.unidade_tributavel` — ver a entrada de B5 no AGENTS.md.
   */
  pis_quantidade_vendida?: number;
  /** `vAliqProd` — a alíquota do PIS **em reais por unidade**, não em porcentagem. */
  pis_aliquota_valor?: number;

  /** `vPIS` — `vBC × pPIS` no caminho percentual, `qBCProd × vAliqProd` no por unidade. */
  pis_valor?: number;

  /** `tax_groups.cst_cofins`. */
  cofins_situacao_tributaria?: string;
  cofins_base_calculo?: number;
  cofins_aliquota_porcentual?: number;
  /** `qBCProd` do grupo `COFINSQtde`. Ver `pis_quantidade_vendida`. */
  cofins_quantidade_vendida?: number;
  /** `vAliqProd` do grupo `COFINSQtde`, em reais por unidade. */
  cofins_aliquota_valor?: number;
  cofins_valor?: number;

  /* --- Lei da Transparência Fiscal, Lei 12.741/2012 (B9, 05/09/2026) --- */

  /**
   * `vTotTrib` (id `M02`) — o valor aproximado dos tributos federais, estaduais
   * e municipais deste item. Filho **direto** de `det/imposto`, não de nenhum
   * grupo `ICMS`/`PIS`/`COFINS`, e `Decimal[13.2]` na tabela de campos da Focus
   * NFe (nome do campo: `valor_total_tributos`, o mesmo do cabeçalho).
   *
   * **Opcional, e é o único campo deste motor cuja ausência é comportamento
   * normal e não recusa.** Sem linha em `ibpt_rates` para o NCM, o campo não
   * vai e a nota é emitida do mesmo jeito — ver a nota grande em
   * `resolveIbptRate` (`ibptRates.ts`) para as três razões.
   *
   * ## A Focus calcula este campo sozinha quando ele não vem
   *
   * A tabela de campos dela diz, dos dois `valor_total_tributos`: "calculado
   * automaticamente pela API, exceto quando `consumidor_final = 0` e/ou quando
   * constar algum dos termos `REMESSA | EXPORTACAO | DEVOLUCAO | LANCAMENTO`
   * no campo `natureza_operacao`" — usando a própria tabela do IBPT por NCM.
   *
   * Mandar o campo é, portanto, **substituir** a estimativa do provedor pela do
   * cadastro do contador, e isso é deliberado: o número passa a sair da tabela
   * que o contador transcreveu e conferiu, com fonte e versão registradas em
   * `ibpt_rates`, e a nota deixa de depender de uma conta que o provedor faz
   * sem o sistema ver. Onde não há cadastro o campo não vai, e o provedor volta
   * a preencher — degradação para o comportamento de antes de B9, não para
   * campo vazio.
   */
  valor_total_tributos?: number;
};

/**
 * Nota referenciada (grupo `ide`/`NFref`, tag XML `refNFe`) — obrigatória na
 * **nota de devolução**: a NF-e de entrada com `finalidade_emissao: 4` precisa
 * apontar a chave de acesso da nota original que está sendo devolvida.
 *
 * O nome do campo (`notas_referenciadas`, com `chave_nfe` dentro) veio da
 * tabela completa de campos da Focus NFe
 * (https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html) — a página de
 * referência do endpoint (`doc.focusnfe.com.br/reference/emitir_nfe`) **não**
 * documenta este grupo, exatamente a mesma divisão de documentação já
 * registrada na etapa F1 para os campos de valor de imposto.
 */
export type NfePayloadNotaReferenciada = {
  /** Chave de acesso de 44 dígitos da nota referenciada (Focus: `chave_nfe`, XML: `refNFe`). */
  chave_nfe: string;
};

/** Forma de pagamento (grupo `pag`). Obrigatória na NFC-e. */
export type NfePayloadPagamento = {
  /** Código da SEFAZ: 01 = dinheiro, 03 = cartão de crédito, 17 = PIX, 90 = sem pagamento. */
  forma_pagamento: string;
  valor_pagamento: number;
};

/**
 * O corpo da emissão. Um tipo só para NF-e e NFC-e porque a Focus usa o mesmo
 * formato nos dois endpoints (`/v2/nfe` e `/v2/nfce`); o que muda é qual
 * subconjunto é obrigatório — `presenca_comprador` e `formas_pagamento` na
 * NFC-e, endereço completo do destinatário na NF-e.
 */
export type NfePayload = {
  /* --- ide: identificação da operação --- */
  natureza_operacao: string;
  /** ISO 8601 com fuso, ex.: "2026-08-18T14:35:00-03:00". */
  data_emissao: string;
  data_entrada_saida?: string;
  /** 0 = entrada, 1 = saída. */
  tipo_documento: number;
  /** 1 = operação interna, 2 = interestadual, 3 = exterior. */
  local_destino?: number;
  /** 1 = normal, 2 = complementar, 3 = ajuste, 4 = devolução. */
  finalidade_emissao: number;
  /** 0 = não, 1 = sim (consumidor final). */
  consumidor_final?: number;
  /** 0 = não se aplica, 1 = presencial, 4 = entrega a domicílio, 9 = não presencial. */
  presenca_comprador?: number;

  /* --- emit: a filial (branches) --- */
  cnpj_emitente: string;
  nome_emitente: string;
  nome_fantasia_emitente?: string;
  logradouro_emitente?: string;
  numero_emitente?: string;
  bairro_emitente?: string;
  municipio_emitente?: string;
  uf_emitente?: string;
  cep_emitente?: string;
  /** `branches.inscricao_estadual`. */
  inscricao_estadual_emitente?: string;
  /** `branches.regime_tributario` (CRT): 1 = Simples, 2 = Simples c/ excesso, 3 = Normal. */
  regime_tributario_emitente?: number;

  /* --- dest: o cliente (contacts) --- */
  nome_destinatario?: string;
  cnpj_destinatario?: string;
  cpf_destinatario?: string;
  inscricao_estadual_destinatario?: string;
  /** 1 = contribuinte, 2 = isento, 9 = não contribuinte. */
  indicador_inscricao_estadual_destinatario?: number;
  logradouro_destinatario?: string;
  numero_destinatario?: string;
  bairro_destinatario?: string;
  municipio_destinatario?: string;
  uf_destinatario?: string;
  cep_destinatario?: string;
  pais_destinatario?: string;
  telefone_destinatario?: string;

  /* --- total --- */
  valor_produtos: number;
  valor_total: number;
  valor_desconto?: number;
  valor_frete?: number;
  valor_seguro?: number;
  valor_outras_despesas?: number;
  icms_base_calculo?: number;
  icms_valor_total?: number;
  /**
   * `vBCST` do grupo `total` — a soma das bases de ICMS-ST dos itens (B2).
   * O nome repete o do campo de item porque é o que a Focus usa nos dois
   * lugares; o que os distingue é o nível em que aparecem.
   */
  icms_base_calculo_st?: number;
  /** `vST` — a soma do ICMS-ST dos itens (B2). Entra no `valor_total`. */
  icms_valor_total_st?: number;
  /** `vFCPST` do grupo `total` — a soma do FCP-ST dos itens (B2). Entra no `valor_total`. */
  fcp_valor_total_st?: number;
  /**
   * `vFCPUFDest`, `vICMSUFDest` e `vICMSUFRemet` do grupo `total` — as somas
   * dos campos homônimos dos itens (B4, 04/09/2026).
   *
   * **Nenhum dos três entra no `valor_total`**, e é a diferença que separa o
   * DIFAL do ICMS-ST e do IPI: a regra `W16-10` define `vNF` como
   * `vProd − vDesc − vICMSDeson + vST + vFCPST + vFrete + vSeg + vOutro + vII
   * + vIPI + …`, e o DIFAL não é parcela dela. Ele não é acrescido ao
   * documento — já está embutido no preço da mercadoria, que é o que a base
   * única do Convênio ICMS 236/2021 significa. Somá-lo em `valor_total` seria
   * cobrar duas vezes e rejeitar a nota.
   */
  fcp_valor_total_uf_destino?: number;
  /** `vICMSUFDest` do grupo `total`. Ver `fcp_valor_total_uf_destino`. */
  icms_valor_total_uf_destino?: number;
  /** `vICMSUFRemet` do grupo `total` — zero desde 2019, pelo mesmo motivo do campo do item. */
  icms_valor_total_uf_remetente?: number;
  valor_ipi?: number;
  valor_pis?: number;
  valor_cofins?: number;
  /**
   * `vTotTrib` do grupo `total`/`ICMSTot` (id `W16a`) — a soma dos
   * `valor_total_tributos` dos itens (B9, 05/09/2026).
   *
   * **Existe, ao contrário do que se poderia supor pelo desenho do DIFAL.** O
   * `vTotTrib` é dos poucos campos que aparecem nos dois níveis, e a soma não é
   * cosmética: a regra de validação exige que o `W16a` seja **exatamente** a
   * soma dos `M02` dos itens, sob pena de **rejeição 685** ("Total do Valor
   * Aproximado dos Tributos difere do somatório dos itens"), sem tolerância de
   * arredondamento. Declarar o campo nos itens e não no total é rejeição certa.
   *
   * Por isso a soma é feita a partir dos valores **já arredondados** dos itens
   * (`totalDeclarado`), e não recalculada sobre o total da nota.
   *
   * **Não entra no `valor_total`**, pelo mesmo motivo do DIFAL e por um a mais:
   * a regra `W16-10` não o lista entre as parcelas de `vNF`, e ele não é um
   * imposto a recolher — é uma estimativa informativa do que já está embutido
   * no preço (Decreto 8.264/2014, art. 6º). Somá-lo dobraria o valor da nota.
   */
  valor_total_tributos?: number;
  /** 0 = por conta do emitente ... 9 = sem frete. */
  modalidade_frete?: number;

  /**
   * Notas referenciadas (grupo `NFref`). Preenchido só pela nota de devolução
   * (`finalidade_emissao: 4`), com a chave da nota original.
   */
  notas_referenciadas?: NfePayloadNotaReferenciada[];

  items: NfePayloadItem[];
  formas_pagamento?: NfePayloadPagamento[];

  informacoes_adicionais_contribuinte?: string;
};
