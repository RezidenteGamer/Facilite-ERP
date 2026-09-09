/**
 * **Validação estrutural do `NfePayload`, antes de qualquer provedor (A9, 09/09/2026).**
 *
 * ## Onde este validador roda — e por que ele saiu do provedor simulado
 *
 * Até A9 esta função morava dentro de `simulatedFiscalProvider.ts`, e isso
 * tinha três consequências, todas ruins:
 *
 * 1. **Ela só rodava com `FISCAL_PROVIDER=simulado`.** O caminho do provedor
 *    real (`focusProvider.ts`) não passava por ela, e não passaria quando A12
 *    o ligasse — a validação local existiria ou não conforme uma variável de
 *    ambiente. Validar é do sistema, não do transporte.
 * 2. **Uma nota obviamente errada gastaria uma chamada de rede** (e, com o
 *    provedor real, possivelmente um crédito) para voltar recusada por algo que
 *    dava para ver aqui: CNPJ com dígito verificador errado, CEP com 7 dígitos,
 *    filial sem endereço.
 * 3. **A recusa era gravada como se fosse da SEFAZ.** O provedor simulado
 *    respondia `erro_autorizacao` com `statusSefaz: "225"` e "Rejeição: falha no
 *    schema XML da NF-e", e `persistEmission` escrevia isso em
 *    `fiscal_documents`. Mas ninguém falou com a SEFAZ — o `cStat` era
 *    inventado. É o mesmo erro que A5 recusou ao escrever, na liberação de
 *    reserva, que aquilo "não é recusa da SEFAZ".
 *
 * Desde A9 ele roda em `handleEmit` (`fiscal-emit/index.ts`), **depois de
 * `buildPayload` e antes de `reserveEmission`**: os dois provedores passam pelo
 * mesmo crivo, nenhuma reserva é criada para uma nota que não vai sair, e a
 * recusa volta como erro de negócio — o mesmo `outcome(errors)` que os erros do
 * próprio `buildPayload` já usavam —, sem inventar `cStat` nenhum.
 *
 * **O provedor simulado deixou de validar.** Não sobrou cópia: ele agora aceita
 * o payload que recebe e o transforma em documento, que é o papel de um
 * transporte. Quem exercita o caminho de recusa é esta função, direto, sem
 * provedor no meio (`tests/unit/fiscalPayloadValidation.test.ts`).
 *
 * ## O limite: estrutura, nunca aritmética de imposto
 *
 * Este validador confere **presença, formato e vocabulário**. Ele não recalcula
 * base, alíquota nem valor de imposto nenhum, e não confere a coerência entre
 * eles — isso é o motor de B1–B10, e uma segunda conta aqui seria a segunda
 * opinião que este projeto evita. Dos valores, ele exige só que sejam números
 * finitos e não negativos: `-1` não é um preço, e `NaN` não é um número, mas
 * "este `vICMS` bate com esta base?" não é pergunta desta camada.
 *
 * ## O que ficou deliberadamente de fora
 *
 * - **Formato de Inscrição Estadual por estado.** São 27 formatos distintos,
 *   cada um com máscara e dígito verificador próprios (e alguns com mais de uma
 *   regra vigente conforme a época do cadastro). Implementá-los é trabalho
 *   genuíno e grande o bastante para ser tarefa própria — e uma tabela errada
 *   aqui recusaria nota que a SEFAZ aceita, que é o pior desfecho possível para
 *   um validador local. O que A9 confere da IE é **quando ela deve existir**
 *   (regra `E17`, abaixo), não como ela é escrita por dentro.
 * - **CEP do destinatário como obrigatório.** No leiaute 4.00 o `CEP` do
 *   `enderEmit` (id `C13`) é `1-1` e o do `enderDest` (id `E13`) é `0-1`. O
 *   validador segue a diferença ao pé da letra: exige o do emitente, e do
 *   destinatário confere só o formato quando ele vem. Ser mais rígido que a
 *   regra real é exatamente o risco que este arquivo existe para não correr.
 * - **Coerência entre município e UF, e código IBGE de município.** O payload
 *   não carrega `cMun`; quem o deriva é o provedor a partir do nome do
 *   município e da UF. Não há o que conferir aqui sem inventar cadastro.
 */

import { onlyDigits, resolveUfCode } from "./accessKey.ts";
import { isValidCnpj, isValidCpf } from "./cpfCnpj.ts";
import type { FiscalModel, NfePayload, NfePayloadItem } from "./types.ts";

/**
 * CRT — Código de Regime Tributário do emitente (id `C21`).
 *
 * Vocabulário **do próprio motor**, não um inventado aqui: `1` Simples
 * Nacional, `2` Simples Nacional com excesso de sublimite e `3` Regime Normal
 * são os três que `branches.regime_tributario` já usa e que `taxGroups.ts`
 * cruza para escolher entre CST e CSOSN; `4` (Simples Nacional — MEI) entrou
 * pela NT 2024.001 e está em `REGIMES_OPTANTES_SIMPLES` (`taxSituations.ts`)
 * desde a correção de 04/09/2026.
 */
const REGIMES_TRIBUTARIOS_VALIDOS = new Set([1, 2, 3, 4]);

/**
 * `indIEDest` (id `E16a`): `1` contribuinte de ICMS, `2` contribuinte isento de
 * inscrição, `9` não contribuinte. Mesmo vocabulário de
 * `resolveIndicadorIeCodigo` em `invoiceMapping.ts`.
 */
const INDICADORES_IE_VALIDOS = new Set([1, 2, 9]);

/** Texto ausente, vazio ou só espaços — os três são "não informado". */
function ausente(valor: string | null | undefined): boolean {
  return !valor || valor.trim().length === 0;
}

/**
 * Número que não seja finito e não negativo.
 *
 * `NaN` e `Infinity` entram aqui junto do negativo de propósito: os três são
 * resultado de conta que deu errado antes de chegar ao payload, e nenhum deles
 * é um valor que se declare numa nota. O que **não** se confere é se o número
 * está certo — ver o cabeçalho.
 */
function numeroInvalido(valor: number): boolean {
  return !(Number.isFinite(valor) && valor >= 0);
}

/** O mesmo, para campo opcional: ausente é resposta legítima, presente e torto não. */
function valorInvalido(valor: number | undefined): boolean {
  return valor !== undefined && numeroInvalido(valor);
}

/** Sigla de UF que este sistema conhece — a mesma tabela que monta o `cUF` da chave. */
function ufDesconhecida(uf: string | null | undefined): boolean {
  return resolveUfCode({ uf: uf ?? null }) === null;
}

/** CEP é `Integer[8]` no leiaute: oito dígitos, com ou sem o hífen do cadastro. */
function cepInvalido(cep: string): boolean {
  return onlyDigits(cep).length !== 8;
}

/**
 * Os campos do grupo de endereço que o leiaute traz com ocorrência `1-1` nos
 * dois lados (`enderEmit` ids `C06`/`C07`/`C09`/`C11`/`C12`, `enderDest` ids
 * `E06`/`E07`/`E09`/`E11`/`E12`). O CEP fica de fora porque só é obrigatório de
 * um dos lados — ver o cabeçalho.
 */
type Endereco = {
  logradouro: string | undefined;
  numero: string | undefined;
  bairro: string | undefined;
  municipio: string | undefined;
  uf: string | undefined;
  cep: string | undefined;
};

function validaEndereco(endereco: Endereco, quem: string, cepObrigatorio: boolean): string[] {
  const problems: string[] = [];
  if (ausente(endereco.logradouro)) problems.push(`Endereço do ${quem}: logradouro ausente`);
  if (ausente(endereco.numero)) problems.push(`Endereço do ${quem}: número ausente`);
  if (ausente(endereco.bairro)) problems.push(`Endereço do ${quem}: bairro ausente`);
  if (ausente(endereco.municipio)) problems.push(`Endereço do ${quem}: município ausente`);

  if (ausente(endereco.uf)) {
    problems.push(`Endereço do ${quem}: UF ausente`);
  } else if (ufDesconhecida(endereco.uf)) {
    problems.push(`Endereço do ${quem}: UF "${endereco.uf}" não é uma sigla de unidade federativa`);
  }

  if (ausente(endereco.cep)) {
    if (cepObrigatorio) problems.push(`Endereço do ${quem}: CEP ausente`);
  } else if (cepInvalido(endereco.cep!)) {
    problems.push(`Endereço do ${quem}: CEP fora do formato de 8 dígitos`);
  }

  return problems;
}

/** Emitente: quem assina a nota (grupo `emit`). Igual para NF-e e NFC-e. */
function validaEmitente(payload: NfePayload): string[] {
  const problems: string[] = [];

  if (ausente(payload.cnpj_emitente)) {
    problems.push("CNPJ do emitente ausente");
  } else if (!isValidCnpj(payload.cnpj_emitente)) {
    // Uma mensagem só para as três causas (tamanho, dígito verificador,
    // sequência repetida) porque a correção é a mesma: conferir o cadastro da
    // filial. Dizer *qual* das três falhou não muda o que quem lê vai fazer.
    problems.push("CNPJ do emitente inválido (dígito verificador não confere)");
  }

  if (ausente(payload.nome_emitente)) problems.push("Nome do emitente ausente");
  if (ausente(payload.inscricao_estadual_emitente)) {
    problems.push("Inscrição estadual do emitente ausente");
  }

  problems.push(
    ...validaEndereco(
      {
        logradouro: payload.logradouro_emitente,
        numero: payload.numero_emitente,
        bairro: payload.bairro_emitente,
        municipio: payload.municipio_emitente,
        uf: payload.uf_emitente,
        cep: payload.cep_emitente,
      },
      "emitente",
      true,
    ),
  );

  const regime = payload.regime_tributario_emitente;
  if (regime === undefined) {
    problems.push("Regime tributário do emitente (CRT) ausente");
  } else if (!REGIMES_TRIBUTARIOS_VALIDOS.has(regime)) {
    problems.push(
      `Regime tributário do emitente (CRT) inválido: ${regime} — os válidos são 1, 2, 3 e 4`,
    );
  }

  return problems;
}

/**
 * Destinatário (grupo `dest`).
 *
 * **Obrigatório na NF-e, opcional na NFC-e** — é a diferença que já estava
 * escrita em `NfePayload` ("endereço completo do destinatário na NF-e") e em
 * `buildNfceDestinatarioFields` ("sem cliente, o grupo inteiro sai do
 * payload"): a venda de balcão sem CPF é a operação mais comum do PDV, e
 * ausência do grupo é o que significa "sem identificação".
 */
function validaDestinatario(payload: NfePayload, model: FiscalModel): string[] {
  const problems: string[] = [];
  const obrigatorio = model === "nfe";

  const temCnpj = !ausente(payload.cnpj_destinatario);
  const temCpf = !ausente(payload.cpf_destinatario);

  if (temCnpj && temCpf) {
    // `CNPJ` e `CPF` são um `xs:choice` no grupo `dest`: um documento, nunca
    // dois. Vale para os dois modelos.
    problems.push("Destinatário com CNPJ e CPF ao mesmo tempo — informe só um dos dois");
  }
  if (temCnpj && !isValidCnpj(payload.cnpj_destinatario)) {
    problems.push("CNPJ do destinatário inválido (dígito verificador não confere)");
  }
  if (temCpf && !isValidCpf(payload.cpf_destinatario)) {
    problems.push("CPF do destinatário inválido (dígito verificador não confere)");
  }

  if (!temCnpj && !temCpf) {
    if (obrigatorio) problems.push("NF-e sem destinatário identificado: informe o CNPJ ou o CPF");
    // Numa NFC-e sem identificação não há o que conferir adiante — nem nome,
    // nem endereço, nem indicador de IE. O grupo simplesmente não existe.
    if (!obrigatorio) return problems;
  }

  if (obrigatorio && ausente(payload.nome_destinatario)) {
    problems.push("Nome do destinatário ausente");
  }

  const indicador = payload.indicador_inscricao_estadual_destinatario;
  if (indicador === undefined) {
    if (obrigatorio) problems.push("Indicador de inscrição estadual do destinatário (indIEDest) ausente");
  } else if (!INDICADORES_IE_VALIDOS.has(indicador)) {
    problems.push(
      `Indicador de inscrição estadual do destinatário (indIEDest) inválido: ${indicador} — os válidos são 1, 2 e 9`,
    );
  }

  // Regra `E17` do leiaute: a IE do destinatário é informada **somente** quando
  // `indIEDest = 1`. Informá-la junto do indicador de isento é a rejeição 791,
  // já citada em `invoiceMapping.ts`; omiti-la quando o destinatário é
  // contribuinte deixa a nota sem o dado que o grupo exige. O que **não** se
  // confere é o formato dela — ver o cabeçalho.
  const temIe = !ausente(payload.inscricao_estadual_destinatario);
  if (indicador === 1 && !temIe) {
    problems.push("Destinatário declarado contribuinte de ICMS (indIEDest = 1) e sem inscrição estadual");
  }
  if (indicador !== undefined && indicador !== 1 && temIe) {
    problems.push(
      `Inscrição estadual do destinatário informada com indIEDest = ${indicador} — ela só é informada quando o destinatário é contribuinte (1)`,
    );
  }

  // Endereço do destinatário: exigido na NF-e, dispensado na NFC-e (não se pede
  // endereço num balcão). Quando ele vem numa NFC-e, o formato ainda é
  // conferido — via `validaEndereco`, abaixo, só nos campos que chegaram.
  if (obrigatorio) {
    problems.push(
      ...validaEndereco(
        {
          logradouro: payload.logradouro_destinatario,
          numero: payload.numero_destinatario,
          bairro: payload.bairro_destinatario,
          municipio: payload.municipio_destinatario,
          uf: payload.uf_destinatario,
          cep: payload.cep_destinatario,
        },
        "destinatário",
        false,
      ),
    );
  } else {
    if (!ausente(payload.uf_destinatario) && ufDesconhecida(payload.uf_destinatario)) {
      problems.push(
        `Endereço do destinatário: UF "${payload.uf_destinatario}" não é uma sigla de unidade federativa`,
      );
    }
    if (!ausente(payload.cep_destinatario) && cepInvalido(payload.cep_destinatario!)) {
      problems.push("Endereço do destinatário: CEP fora do formato de 8 dígitos");
    }
  }

  return problems;
}

/** Um item (grupo `det`). Presença, unidade e sinal dos valores — nada de imposto. */
function validaItem(item: NfePayloadItem): string[] {
  const problems: string[] = [];
  const onde = `item ${item.numero_item}`;

  if (ausente(item.descricao)) problems.push(`${onde}: descrição ausente`);
  if (ausente(item.cfop)) problems.push(`${onde}: CFOP ausente`);
  if (ausente(item.codigo_ncm)) problems.push(`${onde}: NCM ausente`);
  if (ausente(item.icms_situacao_tributaria)) {
    problems.push(`${onde}: situação tributária do ICMS (CST/CSOSN) ausente`);
  }

  // `uCom` (id `I09`) e `uTrib` (id `I13`) são `1-1` no grupo `prod`, e desde
  // A4 (06/09/2026) as contrapartes deles — `qTrib` e `vUnTrib` — já viajam
  // sempre. Faltava exigir as unidades em si, que vêm só do cadastro do
  // produto (`products.unidade_comercial` / `unidade_tributavel`, ambas
  // anuláveis) e não têm como ser deduzidas.
  if (ausente(item.unidade_comercial)) problems.push(`${onde}: unidade comercial ausente`);
  if (ausente(item.unidade_tributavel)) problems.push(`${onde}: unidade tributável ausente`);

  if (!(item.quantidade_comercial > 0)) problems.push(`${onde}: quantidade deve ser maior que zero`);
  if (item.quantidade_tributavel !== undefined && !(item.quantidade_tributavel > 0)) {
    problems.push(`${onde}: quantidade tributável deve ser maior que zero`);
  }

  const obrigatorios: Array<[string, number]> = [
    ["valor unitário comercial", item.valor_unitario_comercial],
    ["valor bruto", item.valor_bruto],
  ];
  for (const [nome, valor] of obrigatorios) {
    if (numeroInvalido(valor)) problems.push(`${onde}: ${nome} deve ser um número não negativo`);
  }

  const opcionais: Array<[string, number | undefined]> = [
    ["valor unitário tributável", item.valor_unitario_tributavel],
    ["valor de desconto", item.valor_desconto],
    ["valor de frete", item.valor_frete],
  ];
  for (const [nome, valor] of opcionais) {
    if (valorInvalido(valor)) problems.push(`${onde}: ${nome} deve ser um número não negativo`);
  }

  return problems;
}

/**
 * Confere o payload que está prestes a ir para um provedor — qualquer um deles.
 *
 * Devolve a lista de problemas em português, pronta para virar `errors` na
 * resposta de `fiscal-emit`. Lista vazia significa "estruturalmente emissível",
 * **não** "a SEFAZ vai autorizar": quem decide isso é a SEFAZ.
 */
export function validarPayloadFiscal(payload: NfePayload, model: FiscalModel): string[] {
  const problems: string[] = [];

  if (ausente(payload.natureza_operacao)) problems.push("Natureza da operação ausente");
  if (ausente(payload.data_emissao)) problems.push("Data de emissão ausente");

  problems.push(...validaEmitente(payload));
  problems.push(...validaDestinatario(payload, model));

  const totaisObrigatorios: Array<[string, number]> = [
    ["Valor dos produtos", payload.valor_produtos],
    ["Valor total da nota", payload.valor_total],
  ];
  for (const [nome, valor] of totaisObrigatorios) {
    if (numeroInvalido(valor)) problems.push(`${nome} deve ser um número não negativo`);
  }

  const totaisOpcionais: Array<[string, number | undefined]> = [
    ["Valor de desconto", payload.valor_desconto],
    ["Valor do frete", payload.valor_frete],
    ["Valor do seguro", payload.valor_seguro],
    ["Valor de outras despesas", payload.valor_outras_despesas],
  ];
  for (const [nome, valor] of totaisOpcionais) {
    if (valorInvalido(valor)) problems.push(`${nome} deve ser um número não negativo`);
  }

  if (!payload.items?.length) {
    problems.push("Nota sem itens");
  } else {
    for (const item of payload.items) problems.push(...validaItem(item));
  }

  return problems;
}
