/**
 * Contrato de emissão fiscal (NF-e / NFC-e).
 *
 * Mesmo papel que `ModuleDataRepository<T>` cumpre para dado de módulo: os
 * módulos que vão emitir nota (Notas Emitidas, NFC-e, Devolução) falam só com
 * esta interface, nunca com um provedor concreto. Hoje a única implementação é
 * o `SimulatedFiscalProvider`, que não faz chamada de rede nenhuma; quando a
 * ativação real acontecer (CNPJ + certificado A1 + mensalidade de provedor),
 * entra um `FocusNfeProvider` no mesmo contrato e nenhum módulo muda.
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
 * A interface. Três métodos, nenhum a mais.
 *
 * **Rejeição não é exceção.** Uma nota recusada pela SEFAZ volta como
 * `status: "erro_autorizacao"` com `mensagemSefaz` preenchida — é resultado de
 * negócio que a tela precisa mostrar, não falha de programa. As implementações
 * só lançam quando o transporte falha (rede fora, token inválido, resposta
 * ilegível), que é o caso em que não há o que exibir.
 */
export type FiscalProvider = {
  /** Identifica a implementação ativa nos logs e na tela de configurações. */
  readonly id: string;
  emit(request: FiscalEmitRequest): Promise<FiscalDocument>;
  cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult>;
  query(ref: string): Promise<FiscalDocument>;
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
  icms_base_calculo?: number;
  icms_aliquota?: number;
  icms_valor?: number;

  /** `products.cst_ipi`. */
  ipi_situacao_tributaria?: string;
  ipi_base_calculo?: number;
  ipi_aliquota?: number;
  ipi_valor?: number;

  /** `products.cst_pis`. */
  pis_situacao_tributaria?: string;
  pis_base_calculo?: number;
  pis_aliquota_porcentual?: number;
  pis_valor?: number;

  /** `products.cst_cofins`. */
  cofins_situacao_tributaria?: string;
  cofins_base_calculo?: number;
  cofins_aliquota_porcentual?: number;
  cofins_valor?: number;
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
  valor_ipi?: number;
  valor_pis?: number;
  valor_cofins?: number;
  /** 0 = por conta do emitente ... 9 = sem frete. */
  modalidade_frete?: number;

  items: NfePayloadItem[];
  formas_pagamento?: NfePayloadPagamento[];

  informacoes_adicionais_contribuinte?: string;
};
