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
 *
 * **Não é o vocabulário da Focus, e A12 precisa traduzir** (conferido em A4,
 * 06/09/2026). Nos dois endpoints de evento o `status` da resposta é
 * `"autorizado"` ou `"erro_autorizacao"` — o mesmo par da emissão, sem termo
 * próprio de evento (`CartaCorrecaoResponse` e `InutilizacaoResponse`, ambos em
 * doc.focusnfe.com.br, `updatedAt` 12/08/2026). O que a Focus chama de
 * `"autorizado"` aqui vira `registrado`; `"erro_autorizacao"` vira
 * `erro_evento`; `nao_encontrado` é nosso, e sai do HTTP 404 (`{"codigo":
 * "nao_encontrado"}`).
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
 *
 * **O `path` da Focus é relativo ao host da API**, no formato
 * `/arquivos/<cnpj>_<id>/<AAAAMM>/XMLs/<chave>-nfe.xml` (exemplos da própria
 * documentação, acesso em 06/09/2026). Baixar é `GET https://api.focusnfe.com.br<path>`
 * com o mesmo Basic Auth, e a API responde **302** com a URL pré-assinada no
 * `Location` — que já autoriza sozinha e **não** deve levar o header de
 * `Authorization` junto. Guardar o `path` (e não a URL do `Location`) é o certo:
 * a pré-assinada expira, o caminho não.
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
  /**
   * Chave de acesso de **44 dígitos**, sem prefixo (Focus: `chave_nfe`). Nula
   * enquanto não autorizada.
   *
   * **A Focus devolve com o literal `NFe` na frente** — 3 letras seguidas dos
   * 44 dígitos, como em `"NFe41190612345678000123550010000000221923094166"` —
   * em `chave_nfe` de emissão e de consulta, nos dois modelos (exemplos de `emitir_nfe`, `emitir_nfce`, `consultar_nfe` e
   * `consultar_nfce`, acesso em 06/09/2026; a forma nua de 44 dígitos só
   * aparece dentro do objeto `protocolo_nota_fiscal` do `completa=1`). O
   * adaptador de A12 **tem que tirar o prefixo** antes de preencher este campo:
   * é ele que `accessKey.ts` valida e que a coluna `fiscal_documents.chave`
   * guarda, e 47 caracteres quebrariam as duas pontas.
   */
  chave: string | null;
  /** Número sequencial da nota (Focus: `numero`). */
  numero: string | null;
  /** Série (Focus: `serie`). */
  serie: string | null;
  /**
   * Protocolo de autorização da SEFAZ.
   *
   * **Não vem de graça na resposta padrão** (conferido em A4, 06/09/2026). Na
   * NF-e o campo `protocolo` aparece **só** no exemplo `NFeAutorizadaCompleta`,
   * isto é, na consulta feita com `?completa=1`; o `NFeAutorizadaResponse`
   * comum não o declara. Na NFC-e o nome é outro — `numero_protocolo` — e esse
   * vem na consulta simples. A12 precisa, portanto, consultar NF-e com
   * `GET /v2/nfe/<ref>?completa=1` se quiser este campo preenchido, e ler
   * `numero_protocolo` na NFC-e.
   */
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
   *
   * A consulta de NFC-e devolve, ao lado de `qrcode_url`, um `url_consulta_nf`
   * (a URL de consulta pública da nota no portal da SEFAZ) que este contrato
   * **não** modela — nenhuma tela pede, e o QR Code já a carrega dentro. Fica
   * registrado para A12 não achar que sumiu por engano.
   */
  qrCodeUrl: string | null;
};

/**
 * Resultado de um cancelamento. Mais estreito que `FiscalDocument` de propósito:
 * é o que a Focus devolve no DELETE (status + retorno da SEFAZ + XML do evento),
 * sem repetir chave/número/protocolo que quem cancelou já tem em mãos.
 *
 * Conferido campo a campo em A4 (06/09/2026) contra `cancelar_nfe` e
 * `cancelar_nfce` (doc.focusnfe.com.br, `updatedAt` 12/08/2026): os quatro
 * campos da resposta de NF-e são exatamente `status` (`"cancelado"` /
 * `"erro_cancelamento"`), `status_sefaz`, `mensagem_sefaz` e
 * `caminho_xml_cancelamento` — os mesmos quatro que este tipo carrega. A
 * resposta de **NFC-e** traz um quinto, `numero_protocolo` (o protocolo do
 * evento de cancelamento), que este tipo não modela; ver a pendência de A12 no
 * AGENTS.md.
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
  /**
   * Focus: `justificativa`, obrigatória, de 15 a 255 caracteres.
   *
   * Confirmado em A4 (06/09/2026) na própria Focus, e não só na regra da SEFAZ:
   * `cancelar_nfe` e `cancelar_nfce` documentam "deve ter entre 15 e 255
   * caracteres" e devolvem HTTP 400 (`{"codigo": "requisicao_invalida"}`) fora
   * da faixa. O corpo é `{ "justificativa": "..." }` e vai no **DELETE**
   * (`DELETE /v2/nfe/<ref>`, `DELETE /v2/nfce/<ref>`).
   *
   * **Prazo, que é regra de negócio e não de campo:** a Focus documenta 24
   * horas para a NF-e ("alguns estados permitem prazos maiores") e **30
   * minutos** para a NFC-e. Não é "cancelamento simples e sem prazo" — o
   * cliente que precisar cancelar cupom tem meia hora, e passado isso o caminho
   * é nota de devolução.
   */
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
 *
 * ## O mapa de nomes das duas respostas da Focus (conferido em A4, 06/09/2026)
 *
 * As duas respostas **não** usam os mesmos nomes, e é por isso que este tipo é
 * a normalização e não um espelho. Fontes: `emitir_carta_correcao` e
 * `inutilizar_numeracao` (doc.focusnfe.com.br, `updatedAt` 12/08/2026):
 *
 * | este tipo         | CC-e                           | inutilização      |
 * | ----------------- | ------------------------------ | ----------------- |
 * | `status`          | `status` (`autorizado`/`erro_autorizacao`) | idem  |
 * | `statusSefaz`     | `status_sefaz`                 | `status_sefaz`    |
 * | `mensagemSefaz`   | `mensagem_sefaz`               | `mensagem_sefaz`  |
 * | `protocolo`       | **não existe**                 | `protocolo_sefaz` |
 * | `numeroSequencial`| `numero_carta_correcao` (int)  | não existe        |
 * | `xml`             | `caminho_xml_carta_correcao`   | `caminho_xml`     |
 * | `pdf`             | `caminho_pdf_carta_correcao`   | não existe        |
 *
 * A inutilização devolve ainda `cnpj`, `serie`, `numero_inicial`,
 * `numero_final` e `modelo` — eco do que foi pedido, que quem pediu já tem.
 */
export type FiscalEventResult = {
  /** A mesma `ref` da requisição — identifica o evento, não o documento. */
  ref: string;
  status: FiscalEventStatus;
  /** Código de retorno da SEFAZ, ex.: "135" (Focus: `status_sefaz`). */
  statusSefaz: string | null;
  mensagemSefaz: string | null;
  /**
   * Protocolo do evento. Nulo quando o evento foi recusado — **e também na
   * carta de correção do provedor real**.
   *
   * Dizia "(Focus: `protocolo`)" até A4, e estava errado nos dois eventos: o
   * `CartaCorrecaoResponse` **não tem campo de protocolo nenhum** (só `status`,
   * `status_sefaz`, `mensagem_sefaz`, os dois `caminho_*` e
   * `numero_carta_correcao`), e o `InutilizacaoResponse` chama o dele de
   * `protocolo_sefaz`. Quem implementar A12 preenche este campo a partir de
   * `protocolo_sefaz` na inutilização e deixa `null` na CC-e — o protocolo da
   * CC-e existe, mas só dentro do XML do evento, que volta em `xml`.
   */
  protocolo: string | null;
  /**
   * Número sequencial do evento — a CC-e é numerada de 1 a 20 por NF-e (regra
   * da SEFAZ), e é isso que distingue a terceira correção da primeira.
   * `null` na inutilização, que não é um evento *de um documento* e por isso
   * não tem sequência.
   *
   * Focus: `numero_carta_correcao`, `integer` (confirmado em A4). A própria
   * Focus incrementa a sequência a cada chamada, então A12 não precisa
   * calculá-la — só lê a que voltou.
   */
  numeroSequencial: number | null;
  /** XML do evento (Focus: `caminho_xml_carta_correcao` / `caminho_xml`). */
  xml: FiscalArtifact | null;
  /**
   * PDF do evento (Focus: `caminho_pdf_carta_correcao`) — **só a carta de
   * correção tem um**; `null` na inutilização e em todo evento recusado.
   *
   * Campo criado em A4 (06/09/2026): a Focus devolve o PDF da CC-e ao lado do
   * XML e este contrato não tinha onde guardá-lo, de modo que o provedor real
   * teria de jogá-lo fora ou baixá-lo de novo depois. O simulado devolve sempre
   * `null` — ele não gera PDF de evento, e fingir que gera seria pior que a
   * ausência.
   */
  pdf: FiscalArtifact | null;
};

/**
 * Carta de correção eletrônica (CC-e, evento 110110).
 *
 * Corrige erro que **não** altera valores, destinatário nem mercadoria — para
 * isso o caminho é cancelar ou emitir nota de devolução, não corrigir. A SEFAZ
 * exige texto de 15 a 1000 caracteres, e cada NF-e aceita no máximo 20 cartas;
 * a última substitui as anteriores.
 *
 * **Conferido em A4 (06/09/2026)** contra `emitir_carta_correcao`
 * (doc.focusnfe.com.br, `updatedAt` 12/08/2026): endpoint
 * `POST /v2/nfe/{referencia}/carta_correcao`, corpo `{ "correcao": "..." }`,
 * `minLength` 15 e `maxLength` 1000, síncrono. As três restrições que a página
 * lista batem com o que este tipo já dizia (não corrige variável de imposto,
 * nem dado cadastral que troque remetente/destinatário, nem data de emissão ou
 * saída) e o teto de 20 correções também.
 *
 * **Só existe para NF-e.** O índice da documentação (`llms.txt`, acesso em
 * 06/09/2026) tem `emitir_carta_correcao` sob NF-e e **nada** equivalente sob
 * NFC-e — coerente com a legislação, que não prevê CC-e para modelo 65. O
 * provedor real deve recusar o pedido de correção de NFC-e antes de sair para
 * a rede, e não montar `/v2/nfce/<ref>/carta_correcao`.
 */
export type FiscalCorrectionRequest = {
  /** A `ref` do **documento** que está sendo corrigido (Focus: `{referencia}` na URL). */
  ref: string;
  /**
   * Focus: `correcao`. 15 a 1000 caracteres (regra da SEFAZ, e `minLength`/
   * `maxLength` no schema da Focus).
   *
   * O corpo da Focus aceita ainda um `data_evento` opcional (ISO 8601; "se não
   * informado será usado a data atual"), que este tipo não modela — nenhuma
   * tela precisa datar a correção no passado, e a data atual é a certa.
   */
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
 * e não uma `ref` de nota.
 *
 * **Conferido em A4 (06/09/2026)** contra `inutilizar_numeracao` e
 * `inutilizar_numeracao_nfce` (doc.focusnfe.com.br, `updatedAt` 12/08/2026):
 * `POST /v2/nfe/inutilizacao` e `POST /v2/nfce/inutilizacao`, síncronos, com
 * corpo de exatamente **cinco** campos, todos obrigatórios — `cnpj`, `serie`,
 * `numero_inicial`, `numero_final`, `justificativa`. Os cinco nomes deste tipo
 * batem. **Não** há campo de ambiente (é o token que decide produção ou
 * homologação) nem de modelo no corpo: o modelo sai do endpoint, e volta na
 * resposta como `modelo` (`"55"` / `"65"`). Não faltava nada.
 */
export type FiscalInvalidateRequest = {
  /**
   * Identificador do pedido, gerado por nós.
   *
   * **Não tem contrapartida na Focus, e A4 corrigiu a afirmação de que tinha.**
   * O corpo da inutilização não aceita `ref`, a resposta não devolve nenhuma, e
   * `GET /v2/nfe/inutilizacoes` busca por CNPJ/CPF, faixa e datas de
   * recebimento — nunca por referência. Ou seja: no provedor real esta `ref`
   * dá idempotência **do nosso lado** (o registro local do pedido), e nenhuma
   * do lado da Focus; repetir a chamada manda um segundo pedido à SEFAZ, que aí
   * responde com a rejeição dela para faixa já inutilizada. Só o simulado, que
   * guarda as faixas em memória, consegue deduplicar por `ref`.
   */
  ref: string;
  /** CNPJ do emitente (Focus: `cnpj`). */
  cnpj: string;
  /**
   * 55 (NF-e) ou 65 (NFC-e) — a faixa é por modelo, e é este campo que escolhe
   * entre `/v2/nfe/inutilizacao` e `/v2/nfce/inutilizacao`. Não vai no corpo.
   */
  model: FiscalModel;
  /** Focus: `serie` (ver a nota de tipo em `numeroFinal`). */
  serie: number;
  /** Focus: `numero_inicial`. */
  numeroInicial: number;
  /**
   * Focus: `numero_final`.
   *
   * `number` aqui, `string` lá: o `InutilizacaoRequest` da Focus declara
   * `serie`, `numero_inicial` e `numero_final` como `string` (exemplos `"1"`,
   * `"7"`, `"9"`), enquanto o `GET /v2/nfe/inutilizacoes` declara os mesmos
   * números como `integer` nos parâmetros de busca — a própria documentação não
   * é consistente. Os três seguem `number` neste contrato, que é o que eles
   * são; **A12 converte para string ao montar o corpo**, que é a forma
   * documentada do endpoint que grava.
   */
  numeroFinal: number;
  /**
   * Focus: `justificativa`. Mínimo de 15 caracteres.
   *
   * O schema da Focus declara só o mínimo (`minLength: 15`), sem máximo — ao
   * contrário do cancelamento, onde ela documenta 15 a 255. O teto de 255 vem
   * do `xJust` do leiaute da SEFAZ, que é o mesmo nos dois eventos; este motor
   * o mantém por segurança, e a diferença fica registrada para A12 não estranhar
   * um texto longo passar na Focus e ser recusado na SEFAZ.
   */
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
  /**
   * `products.cest` — o Código Especificador da Substituição Tributária (tag
   * XML `CEST`, `Integer[7]`), obrigatório no item sujeito a ICMS-ST.
   *
   * **Chamava-se `codigo_cest` até A4 (06/09/2026), e o nome estava errado.**
   * A única página da Focus que documenta o campo é a tabela completa
   * (https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html, `Last-Modified`
   * 22/08/2026, acesso em 06/09/2026), e lá ele se chama `cest`, sem prefixo —
   * `codigo_cest` não aparece uma única vez na página. A referência do endpoint
   * (`doc.focusnfe.com.br/reference/emitir_nfe`) não documenta CEST nenhum, de
   * modo que não há segunda fonte que sustentasse a grafia antiga. Enquanto só
   * o provedor simulado rodava, o erro era invisível; no provedor real o CEST
   * seria silenciosamente descartado e a nota de produto com ST sairia sem ele.
   *
   * A coluna que o persiste (`fiscal_document_items.cest`) já usava o nome
   * certo desde A3, então a correção não mexeu no banco.
   */
  cest?: string;
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

  /* --- IBS e CBS: o grupo `UB` da NT 2025.002-RTC (B10, 05/09/2026) --- */

  /**
   * `CST` (id `UB13`) do grupo `det/imposto/IBSCBS` — três dígitos, da tabela
   * CST do IBS/CBS do Informe Técnico 2025.002.
   *
   * **É um código só para os dois tributos**, ao contrário de PIS e COFINS,
   * que têm CST próprio cada um. Vem de `tax_groups.cst_ibs_cbs`, coluna que
   * existe desde a criação de `tax_groups` (19/08/2026) e que só agora tem
   * quem a leia.
   *
   * Presente **sempre** que a nota declara IBS/CBS: desde 03/08/2026 a regra
   * `UB12-10` rejeita (1115) a NF-e/NFC-e de Regime Normal sem este grupo. Sai
   * ausente só nos dois casos em que o documento inteiro não declara — emitente
   * optante pelo Simples Nacional e documento de ano fora da transição —, e aí
   * nenhum dos campos abaixo vai junto.
   */
  ibs_cbs_situacao_tributaria?: string;
  /**
   * `cClassTrib` (id `UB14`) — seis dígitos, da Tabela de Classificação
   * Tributária do IBS e da CBS. Os três primeiros são o próprio CST.
   *
   * Ele é o que torna objetiva a informação do contribuinte sobre **como** o
   * item é tributado (qual dispositivo da LC 214/2025 se aplica), e é dele que
   * sai o percentual de redução de alíquota — ver `ibs_uf_percentual_reducao_aliquota`.
   */
  ibs_cbs_classificacao_tributaria?: string;
  /**
   * `vBC` (id `UB16`) do grupo `gIBSCBS` — a base de cálculo **compartilhada**
   * por IBS e CBS. Uma base só para os dois tributos, e não uma por tributo:
   * é a diferença estrutural em relação a ICMS/PIS/COFINS deste mesmo item.
   *
   * Este motor a preenche com o valor bruto do item — a mesma expressão que
   * alimenta todos os outros impostos, para "o valor da operação" ter uma fonte
   * só aqui dentro. A regra `UB16-10` (rejeição 1104) define outra composição
   * (`vProd + vServ + vFrete + vSeg + vOutro + vII − vDesc − vPIS − vCOFINS −
   * vICMS − …`), mas ela está marcada na NT como **"Implementação Futura,
   * aguardando orientação normativa"** e por isso não é conferida hoje. A
   * divergência está registrada como limitação conhecida na entrada de B10 do
   * AGENTS.md.
   */
  ibs_cbs_base_calculo?: number;
  /** `pIBSUF` (id `UB18`) — alíquota nominal do IBS estadual. 0,1% em 2026 (LC 214/2025, art. 343). */
  ibs_uf_aliquota?: number;
  /**
   * `pRedAliq` do grupo `gIBSUF/gRed` (id `UB27`) — o percentual de redução de
   * alíquota que o `cClassTrib` carrega.
   *
   * Sai **apenas** nos CST cujo indicador `ind_gRed` é 1 (`011`, `200`, `515`):
   * o grupo `gRed` num CST que não o admite é a rejeição 1032, e a falta dele
   * num CST que o exige é a 1033. Não existe "redução de zero" — ausente
   * significa que o CST não tem o grupo.
   */
  ibs_uf_percentual_reducao_aliquota?: number;
  /**
   * `pAliqEfet` do grupo `gIBSUF/gRed` (id `UB28`) — `pIBSUF × (1 − pRedAliq/100)`,
   * com 4 casas decimais (regra `UB28-10`, rejeição 1035). É **esta** a alíquota
   * que multiplica a base quando o grupo existe.
   */
  ibs_uf_aliquota_efetiva?: number;
  /** `vIBSUF` (id `UB35`) — `vBC × alíquota aplicada`. Regra `UB35-10`, rejeição 1041. */
  ibs_uf_valor?: number;
  /**
   * `pIBSMun` (id `UB37`) — alíquota nominal do IBS municipal. **Zero em 2026**
   * (regra `UB37-10`), e o grupo `gIBSMun` continua obrigatório mesmo assim: o
   * que é zero é a alíquota, não a existência do grupo.
   */
  ibs_mun_aliquota?: number;
  /** `pRedAliq` do grupo `gIBSMun/gRed` (id `UB46`). Ver `ibs_uf_percentual_reducao_aliquota`. */
  ibs_mun_percentual_reducao_aliquota?: number;
  /** `pAliqEfet` do grupo `gIBSMun/gRed` (id `UB47`). */
  ibs_mun_aliquota_efetiva?: number;
  /** `vIBSMun` (id `UB54`). Zero em 2026, porque `pIBSMun` é zero. */
  ibs_mun_valor?: number;
  /**
   * `vIBS` (id `UB54a`) — o IBS **do item**, que a regra `UB54a-10` (rejeição
   * 1150) define como `vIBSUF + vIBSMun`.
   *
   * Nome do campo na tabela da Focus NFe: `ibs_valor_total`, o mesmo do
   * cabeçalho — a homonímia entre os dois níveis é da própria tabela, como já
   * acontecia com `valor_total_tributos` em B9.
   */
  ibs_valor_total?: number;
  /** `pCBS` (id `UB56`) — alíquota nominal da CBS. 0,9% em 2026 (LC 214/2025, art. 346). */
  cbs_aliquota?: number;
  /**
   * `pRedAliq` do grupo `gCBS/gRed` (id `UB65`) — **coluna própria**, e não a
   * mesma do IBS: o Informe Técnico publica `pRedIBS` e `pRedCBS` separados, e
   * eles divergem (hoje no `cClassTrib` 200025, com 60% de IBS e 100% de CBS).
   */
  cbs_percentual_reducao_aliquota?: number;
  /** `pAliqEfet` do grupo `gCBS/gRed` (id `UB66`). */
  cbs_aliquota_efetiva?: number;
  /** `vCBS` (id `UB70`) — `vBC × alíquota aplicada`. Regra `UB67-10`, rejeição 1069. */
  cbs_valor?: number;
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

  /* --- IBS e CBS: o grupo `IBSCBSTot` (id `W34`) do `total` (B10) --- */

  /**
   * `vBCIBSCBS` (id `W35`) — total da base de cálculo de IBS/CBS, a soma dos
   * `ibs_cbs_base_calculo` dos itens (regra `W35-10`, rejeição 1076).
   *
   * **O grupo de totais e os grupos dos itens andam juntos, nos dois
   * sentidos**: mandar `IBSCBSTot` sem nenhum item com `IBSCBS` é a rejeição
   * 1118 (`W34-10`), e ter item com `IBSCBS` sem o grupo de totais é a 1119
   * (`W34-20`). Por isso todos os campos abaixo são preenchidos em bloco.
   *
   * Como em B9, as somas partem dos valores **já arredondados** dos itens —
   * cada total tem regra própria conferindo a igualdade com o somatório
   * (`W41-10`/1080, `W46-10`/1084, `W47-10`/1085, `W56-10`/1091).
   */
  ibs_cbs_base_calculo?: number;
  /**
   * `vDif` do grupo `total/IBSCBSTot/gIBS/gIBSUF` (id `W38`) — total do
   * diferimento do IBS estadual.
   *
   * **Sempre `0`, e presente de propósito**: os campos dentro de `gIBSUF`,
   * `gIBSMun` e `gCBS` do grupo de totais são de ocorrência `1-1` no leiaute,
   * então omiti-los é erro de schema. Este motor não emite diferimento nenhum
   * (os CST `510`/`515` são recusados por `resolveIbsCbs`), de modo que zero é
   * o número certo — mesma situação do `icms_valor_total_uf_remetente` de B4.
   */
  ibs_uf_valor_total_diferimento?: number;
  /** `vDevTrib` do `gIBS/gIBSUF` (id `W39`) — devolução de tributos. Sempre `0`; ver acima. */
  ibs_uf_valor_total_devolucao?: number;
  /** `vIBSUF` (id `W41`) — soma dos `ibs_uf_valor` dos itens. */
  ibs_uf_valor_total?: number;
  /** `vDif` do `gIBS/gIBSMun` (id `W43`). Sempre `0`. */
  ibs_mun_valor_total_diferimento?: number;
  /** `vDevTrib` do `gIBS/gIBSMun` (id `W44`). Sempre `0`. */
  ibs_mun_valor_total_devolucao?: number;
  /** `vIBSMun` (id `W46`) — soma dos `ibs_mun_valor` dos itens. Zero em 2026. */
  ibs_mun_valor_total?: number;
  /** `vIBS` (id `W47`) — soma dos `ibs_valor_total` dos itens. */
  ibs_valor_total?: number;
  /** `vCredPres` do `gIBS` (id `W48`) — crédito presumido. Sempre `0`; ver `ibs_uf_valor_total_diferimento`. */
  ibs_valor_total_credito_presumido?: number;
  /** `vCredPresCondSus` do `gIBS` (id `W49`) — crédito presumido em condição suspensiva. Sempre `0`. */
  ibs_valor_total_condicao_suspensiva?: number;
  /** `vDif` do `gCBS` (id `W53`). Sempre `0`. */
  cbs_valor_total_diferimento?: number;
  /** `vDevTrib` do `gCBS` (id `W54`). Sempre `0`. */
  cbs_valor_total_devolucao?: number;
  /** `vCBS` (id `W56`) — soma dos `cbs_valor` dos itens. */
  cbs_valor_total?: number;
  /** `vCredPres` do `gCBS` (id `W56a`). Sempre `0`. */
  cbs_valor_total_credito_presumido?: number;
  /** `vCredPresCondSus` do `gCBS` (id `W56b`). Sempre `0`. */
  cbs_valor_total_condicao_suspensiva?: number;

  /** 0 = por conta do emitente ... 9 = sem frete. */
  modalidade_frete?: number;

  /**
   * Notas referenciadas (grupo `NFref`). Preenchido só pela nota de devolução
   * (`finalidade_emissao: 4`), com a chave da nota original.
   */
  notas_referenciadas?: NfePayloadNotaReferenciada[];

  /**
   * Os itens da nota.
   *
   * **As duas páginas da Focus discordam do nome, e A4 (06/09/2026) manteve
   * `items` de propósito.** A referência dos endpoints chama a chave de
   * `items` e a lista entre os campos **obrigatórios** dos dois corpos
   * (`NFeRequest` e `NFCeRequest`, doc.focusnfe.com.br, `updatedAt`
   * 12/08/2026); a tabela completa de campos chama de `itens`
   * (campos.focusnfe.com.br, `Last-Modified` 22/08/2026). Os exemplos de código
   * oficiais usam as duas — `"items"` no exemplo de NF-e, `"itens"` no de NFC-e
   * (focusnfe.com.br/exemplos-de-codigos/php/, acesso em 06/09/2026) —, o que
   * indica que a API aceita as duas grafias como sinônimo.
   *
   * Fica `items` porque é o nome que os dois schemas OpenAPI declaram como
   * obrigatório, e obrigatório é a afirmação mais forte das duas. Confirmar por
   * tentativa quando A12 tiver conta de teste é barato e está anotado lá.
   */
  items: NfePayloadItem[];
  formas_pagamento?: NfePayloadPagamento[];

  informacoes_adicionais_contribuinte?: string;
};
