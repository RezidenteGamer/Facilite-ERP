import { isValidCnpj } from "../../lib/fiscal/cpfCnpj";
import { onlyDigits, resolveUfCode } from "../../lib/fiscal/accessKey";
import { formatDateOnly, todayIso } from "../finance/finance";

/**
 * Domínio da tela de Filiais (D1, 09/09/2026) — tipos, vocabulários e a
 * validação do formulário, tudo puro e sem React nem Supabase, para que a
 * bateria de testes possa exercitá-lo sem subir navegador nem banco.
 *
 * Por que uma tela própria em vez do motor genérico: ver a entrada de D1 no
 * AGENTS.md. O resumo é que `branches` é a tabela que ancora
 * `has_branch_access` para as 12 tabelas isoladas por filial, e a RLS dela é
 * gated por `can_manage_branches()` — uma flag global de papel —, enquanto o
 * motor genérico decide "pode criar/editar/excluir" por
 * `has_permission(module_id, ação)`. Os dois portões não se encontram.
 */

export type BranchAdmin = {
  id: string;
  code: string;
  name: string;
  cnpj: string | null;
  active: boolean;
  inscricaoEstadual: string | null;
  /** CRT (`1`/`2`/`3`/`4`) — guardado como texto, como a coluna. */
  regimeTributario: string | null;
  cnae: string | null;
  codigoIbgeMunicipio: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  allowNegativeStock: boolean;
  /**
   * E-mail que recebe cópia do XML/DANFE das notas desta filial (o endereço do
   * contador, na prática). **Cadastro puro: nada envia e-mail neste sistema
   * hoje** — ver D1 no AGENTS.md.
   *
   * `null` também significa "a coluna ainda não existe neste banco": a
   * migration de D1 foi escrita e não aplicada, e o repositório degrada
   * sozinho quando ela falta (ver `branchesRepository`).
   */
  emailCopiaNotaFiscal: string | null;
  /**
   * Certificado digital A1 (A11, 09/09/2026) — **só o que a Focus devolve
   * sobre ele**, nunca o arquivo nem a senha. Ver `BranchCertificado` e o
   * bloco de certificado mais abaixo neste arquivo.
   *
   * Como `emailCopiaNotaFiscal`, `null` aqui também significa "a coluna ainda
   * não existe neste banco": a migration de A11 foi escrita e não aplicada, e
   * o repositório degrada sozinho quando ela falta.
   */
  certificadoValidoDe: string | null;
  certificadoValidoAte: string | null;
  certificadoCnpj: string | null;
};

export type BranchFormValues = {
  code: string;
  name: string;
  cnpj: string;
  inscricaoEstadual: string;
  regimeTributario: string;
  cnae: string;
  codigoIbgeMunicipio: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  emailCopiaNotaFiscal: string;
  active: boolean;
  allowNegativeStock: boolean;
};

/**
 * CRT do emitente — **o mesmo vocabulário que `payloadValidation.ts` valida**
 * (`REGIMES_TRIBUTARIOS_VALIDOS = {1, 2, 3, 4}`), não uma lista nova. O `4`
 * (MEI) entrou pela NT 2024.001 e é aceito pelo validador desde A9; o catálogo
 * de referência `regimes_tributarios` ainda tem só 1, 2 e 3 — ver D1 no
 * AGENTS.md. Quem manda aqui é o validador, porque é ele que recusa a emissão.
 */
export const REGIMES_TRIBUTARIOS_CRT: { value: string; label: string }[] = [
  { value: "", label: "Não informado" },
  { value: "1", label: "1 — Simples Nacional" },
  { value: "2", label: "2 — Simples Nacional, excesso de sublimite" },
  { value: "3", label: "3 — Regime Normal" },
  { value: "4", label: "4 — Simples Nacional, MEI" },
];

const REGIMES_VALIDOS = new Set(["1", "2", "3", "4"]);

/** Rótulo do CRT para a ficha, sem repetir a lista do formulário. */
export function regimeTributarioLabel(chave: string | null): string {
  if (!chave) return "Não informado";
  return REGIMES_TRIBUTARIOS_CRT.find((item) => item.value === chave)?.label ?? chave;
}

/**
 * As 27 unidades da federação, para o `<select>`. Lista de **apresentação**:
 * quem decide se uma sigla vale é `resolveUfCode` (a tabela de códigos IBGE do
 * núcleo fiscal, usada para montar a chave de acesso). Se as duas divergirem,
 * a validação recusa — a direção segura.
 */
export const UF_SIGLAS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export const EMPTY_BRANCH_FORM: BranchFormValues = {
  code: "",
  name: "",
  cnpj: "",
  inscricaoEstadual: "",
  regimeTributario: "",
  cnae: "",
  codigoIbgeMunicipio: "",
  logradouro: "",
  numero: "",
  bairro: "",
  municipio: "",
  uf: "",
  cep: "",
  emailCopiaNotaFiscal: "",
  active: true,
  allowNegativeStock: false,
};

/** Preenche o formulário a partir de uma filial já cadastrada. */
export function branchFormValuesFrom(branch: BranchAdmin): BranchFormValues {
  return {
    code: branch.code ?? "",
    name: branch.name ?? "",
    cnpj: branch.cnpj ?? "",
    inscricaoEstadual: branch.inscricaoEstadual ?? "",
    regimeTributario: branch.regimeTributario ?? "",
    cnae: branch.cnae ?? "",
    codigoIbgeMunicipio: branch.codigoIbgeMunicipio ?? "",
    logradouro: branch.logradouro ?? "",
    numero: branch.numero ?? "",
    bairro: branch.bairro ?? "",
    municipio: branch.municipio ?? "",
    uf: branch.uf ?? "",
    cep: branch.cep ?? "",
    emailCopiaNotaFiscal: branch.emailCopiaNotaFiscal ?? "",
    active: branch.active,
    allowNegativeStock: branch.allowNegativeStock,
  };
}

/**
 * CNPJ formatado a partir dos 14 dígitos. Existe para o cadastro guardar
 * sempre a mesma forma: a única filial que existe hoje foi criada por SQL com
 * pontuação (`00.000.000/0001-91`), e todo consumidor fiscal normaliza com
 * `onlyDigits` antes de usar — então a escolha é de exibição, e uniformizar é
 * melhor que deixar metade do cadastro com máscara e metade sem.
 */
export function formatCnpj(value: string): string {
  const digitos = onlyDigits(value);
  if (digitos.length !== 14) return value.trim();
  return (
    `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}` +
    `/${digitos.slice(8, 12)}-${digitos.slice(12)}`
  );
}

/** CEP formatado (`01310-100`) quando tem os 8 dígitos; senão, o texto como veio. */
export function formatCep(value: string): string {
  const digitos = onlyDigits(value);
  if (digitos.length !== 8) return value.trim();
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

/**
 * Problemas do formulário, em português, prontos para a tela mostrar. Lista
 * vazia = pode salvar.
 *
 * **A régua é deliberadamente assimétrica**: `code` e `name` são obrigatórios
 * (são `not null` no banco, e o código ainda é `unique`); todo o resto é
 * opcional, porque a coluna é anulável e existe filial que ainda não vai
 * emitir nota. Mas **o que for preenchido tem de estar certo** — um CNPJ com
 * dígito verificador errado passa silenciosamente por todo o cadastro e só
 * aparece como rejeição na hora de emitir, que é exatamente o que A9 existe
 * para não deixar acontecer.
 */
export function validateBranchForm(values: BranchFormValues): string[] {
  const problems: string[] = [];

  if (!values.code.trim()) problems.push("Informe o código da filial.");
  if (!values.name.trim()) problems.push("Informe o nome da filial.");

  const cnpj = values.cnpj.trim();
  if (cnpj && !isValidCnpj(cnpj)) {
    problems.push("CNPJ inválido — confira os dígitos verificadores.");
  }

  const regime = values.regimeTributario.trim();
  if (regime && !REGIMES_VALIDOS.has(regime)) {
    problems.push("Regime tributário (CRT) inválido — os válidos são 1, 2, 3 e 4.");
  }

  const uf = values.uf.trim();
  if (uf && !resolveUfCode({ uf })) {
    problems.push(`UF desconhecida: ${uf}.`);
  }

  const cep = values.cep.trim();
  if (cep && onlyDigits(cep).length !== 8) {
    problems.push("CEP precisa ter 8 dígitos.");
  }

  const ibge = values.codigoIbgeMunicipio.trim();
  if (ibge && onlyDigits(ibge).length !== 7) {
    problems.push("Código IBGE do município precisa ter 7 dígitos.");
  }

  const cnae = values.cnae.trim();
  if (cnae && onlyDigits(cnae).length !== 7) {
    problems.push("CNAE fiscal precisa ter 7 dígitos.");
  }

  const email = values.emailCopiaNotaFiscal.trim();
  // Régua de e-mail de propósito frouxa (tem `@`, tem ponto depois dele, não
  // tem espaço): validar e-mail por regex estrita rejeita endereço legítimo
  // com mais frequência do que aceita endereço errado.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push("E-mail de cópia da nota inválido.");
  }

  return problems;
}

/**
 * Avisos — o que **não** impede salvar, mas impede emitir nota. Existem porque
 * uma filial pode ser criada hoje e só passar a emitir semanas depois: travar
 * o cadastro nos campos fiscais forçaria a inventar um CNPJ para abrir a
 * filial, e um CNPJ inventado é pior que um campo vazio.
 *
 * **A lista espelha `validaEmitente` de `payloadValidation.ts`, campo por
 * campo** — e é isso que a torna útil. Uma versão só com os campos "óbvios"
 * (CNPJ, CRT, IE) ficaria calada diante de uma filial sem logradouro, número,
 * bairro ou CEP, que `validaEndereco(..., 'emitente', true)` recusa do mesmo
 * jeito: o aviso afirmaria que está tudo certo justamente quando não está, que
 * é pior que não existir.
 *
 * Fora daqui de propósito: `nome_emitente` (é `name`, obrigatório no
 * formulário, então nunca falta) e o código IBGE do município (o provedor o
 * deriva do nome do município + UF quando o cadastro não o traz).
 */
export function branchFiscalWarnings(values: BranchFormValues): string[] {
  const warnings: string[] = [];
  if (!values.cnpj.trim()) warnings.push("CNPJ");
  if (!values.regimeTributario.trim()) warnings.push("regime tributário (CRT)");
  if (!values.inscricaoEstadual.trim()) warnings.push("inscrição estadual");
  if (!values.logradouro.trim()) warnings.push("logradouro");
  if (!values.numero.trim()) warnings.push("número");
  if (!values.bairro.trim()) warnings.push("bairro");
  if (!values.municipio.trim()) warnings.push("município");
  if (!values.uf.trim()) warnings.push("UF");
  // CEP é opcional para o destinatário e **obrigatório** para o emitente —
  // `validaEndereco` recebe `cepObrigatorio: true` no caminho do emitente.
  if (!values.cep.trim()) warnings.push("CEP");
  return warnings;
}

/** Texto vazio ou só espaços vira `null` — coluna anulável não guarda `""`. */
function ouNulo(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Nome da coluna de e-mail; ver `BranchAdmin.emailCopiaNotaFiscal`. */
export const COLUNA_EMAIL_COPIA_NOTA = "email_copia_nota_fiscal";

/**
 * Valores do formulário → colunas físicas de `branches`.
 *
 * Mora aqui, e não no repositório, por um motivo prático: o repositório importa
 * `supabaseClient`, que lê `import.meta.env` e não carrega no ambiente de teste
 * em Node. Esta função decide o que é gravado (inclusive o que vira `null`), e
 * lógica que decide o que vai para o banco tem de ser testável.
 *
 * `includeEmail` é explícito, e não lido de um estado global, para que o
 * chamador tenha de dizer o que sabe sobre o schema — ver a sondagem em
 * `branchesRepository`.
 *
 * **Nada de certificado digital sai daqui, e isso é garantia, não descuido**
 * (A11, 09/09/2026). As três colunas de certificado são preenchidas pela
 * resposta da Focus, o que é assunto de A12; e o arquivo `.pfx` e a senha não
 * têm coluna nenhuma, aqui nem em lugar algum deste sistema. Como
 * `BranchFormValues` também não tem campo para eles, não existe caminho — nem
 * por engano — do formulário até o banco carregando certificado. Há teste
 * travando exatamente isto.
 */
export function branchColumnsFromForm(
  values: BranchFormValues,
  options: { includeEmail: boolean },
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    code: values.code.trim(),
    name: values.name.trim(),
    cnpj: ouNulo(formatCnpj(values.cnpj)),
    active: values.active,
    inscricao_estadual: ouNulo(values.inscricaoEstadual),
    regime_tributario: ouNulo(values.regimeTributario),
    cnae: ouNulo(values.cnae),
    codigo_ibge_municipio: ouNulo(values.codigoIbgeMunicipio),
    logradouro: ouNulo(values.logradouro),
    numero: ouNulo(values.numero),
    bairro: ouNulo(values.bairro),
    municipio: ouNulo(values.municipio),
    uf: ouNulo(values.uf.toUpperCase()),
    cep: ouNulo(formatCep(values.cep)),
    allow_negative_stock: values.allowNegativeStock,
  };
  if (options.includeEmail) {
    row[COLUNA_EMAIL_COPIA_NOTA] = ouNulo(values.emailCopiaNotaFiscal);
  }
  return row;
}

/**
 * O erro é "esta coluna não existe"?
 *
 * Só pelo **código**: `42703` é o Postgres recusando um `select` com coluna
 * desconhecida (conferido ao vivo contra este banco), e `PGRST204` é o cache de
 * schema do PostgREST recusando um `insert`/`update` pelo mesmo motivo.
 *
 * Conferir também pelo texto da mensagem seria tentador e é uma armadilha:
 * qualquer outro erro que cite o nome da coluna — uma violação de constraint
 * nela, uma mensagem de policy — seria lido como "a coluna sumiu", e o
 * resultado é pior que um erro na tela, porque a conclusão fica **em cache**
 * pelo resto da sessão.
 */
export function isMissingColumnError(error: ErroDoBanco): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

/** Postgres 23505 — violação de unicidade (aqui, sempre `branches_code_key`). */
export function isDuplicateBranchCodeError(error: ErroDoBanco): boolean {
  return error?.code === "23505";
}

/**
 * O que estas duas funções aceitam: a forma do `PostgrestError` do supabase-js.
 * `message` está declarada e **não é lida por nenhuma das duas** — está aqui
 * para o chamador poder passar o erro inteiro sem montar um objeto, e para
 * deixar visível que a decisão sai do código, nunca do texto.
 */
type ErroDoBanco = { code?: string; message?: string } | null | undefined;

/* ==================================================================== *
 * Certificado digital A1 (A11, 09/09/2026)
 *
 * ## A regra que decide tudo o que vem abaixo
 *
 * **O arquivo `.pfx`/`.p12` e a senha dele não entram neste sistema.** Não em
 * coluna, não em Storage, não em log, não em requisição, e não em memória
 * "só enquanto o formulário está aberto". Um certificado A1 é a chave privada
 * da empresa perante a SEFAZ: quem o tem assina nota em nome dela. Guardá-lo
 * seria assumir uma responsabilidade que este projeto não precisa assumir,
 * porque no desenho da Focus **quem guarda o certificado é a Focus**.
 *
 * Confirmado em `doc.focusnfe.com.br/reference/criar_empresa` e
 * `.../atualizar_empresa` (acesso em 09/09/2026): o certificado vai no
 * **cadastro da empresa** (`POST`/`PUT /v2/empresas`), como
 * `arquivo_certificado_base64` (o PFX/P12 inteiro em base64) mais
 * `senha_certificado` ("obrigatória apenas se informado
 * arquivo_certificado_base64"). Ele **não** faz parte do payload de uma nota —
 * `NfePayload` não tem nada de certificado, e nunca vai ter.
 *
 * O que a Focus devolve, e é só isto que este arquivo modela:
 *
 * | campo da resposta        | o que é                                    |
 * | ------------------------ | ------------------------------------------ |
 * | `certificado_valido_de`  | início da validade                         |
 * | `certificado_valido_ate` | fim da validade — a data que gera o aviso  |
 * | `certificado_cnpj`       | o CNPJ contido no certificado              |
 * | `certificado_especifico` | se o certificado vale só para esta empresa |
 *
 * ## O que não virou coluna, de propósito
 *
 * - **O status derivado.** A tarefa o listava entre as colunas novas, e ele
 *   **não** é uma: "vencendo" vira "vencido" sozinho, com o tempo, sem
 *   ninguém escrever nada. Uma coluna guardando isso estaria errada no dia
 *   seguinte ao dia em que foi gravada, a menos que algo a reescrevesse todo
 *   dia — e construir esse "todo dia" é agendamento, que é exatamente o que
 *   A11 não deve construir. Então o status é **calculado** aqui, a partir das
 *   datas, toda vez que a tela pinta.
 * - **`certificado_especifico`.** Existe na Focus e importa de verdade num ERP
 *   multifilial, mas é comportamento da conta lá, decidido no momento do
 *   envio. Quem envia é A12; a coluna nasce com ela ou não nasce.
 * - **Qualquer coisa parecida com "referência ao arquivo".** Ver
 *   `certificado_digital_ref` na migration de A11.
 * ==================================================================== */

/**
 * O que este sistema sabe sobre o certificado de uma filial: duas datas e um
 * CNPJ, todos vindos da Focus. Repare no que **não** está aqui — arquivo,
 * senha, impressão digital, número de série. Nada disso é modelado porque
 * nada disso é recebido.
 */
export type BranchCertificado = {
  /** `certificado_valido_de` — `YYYY-MM-DD`. */
  validoDe: string | null;
  /** `certificado_valido_ate` — `YYYY-MM-DD`. A âncora de todo o resto. */
  validoAte: string | null;
  /** `certificado_cnpj` — o CNPJ contido no certificado. */
  cnpj: string | null;
};

/** Nomes físicos das três colunas de A11, num lugar só. */
export const COLUNA_CERT_VALIDO_DE = "certificado_valido_de";
export const COLUNA_CERT_VALIDO_ATE = "certificado_valido_ate";
export const COLUNA_CERT_CNPJ = "certificado_cnpj";

export const COLUNAS_CERTIFICADO = [
  COLUNA_CERT_VALIDO_DE,
  COLUNA_CERT_VALIDO_ATE,
  COLUNA_CERT_CNPJ,
] as const;

/** O certificado de uma filial já lida, pronto para as funções abaixo. */
export function branchCertificado(branch: BranchAdmin): BranchCertificado {
  return {
    validoDe: branch.certificadoValidoDe,
    validoAte: branch.certificadoValidoAte,
    cnpj: branch.certificadoCnpj,
  };
}

/**
 * Vocabulário do status derivado.
 *
 * - `sem_certificado` — não há `validoAte` gravado. **É o estado de todas as
 *   filiais hoje**, porque nada neste sistema escreve essas colunas até A12.
 * - `nao_vigente` — a validade ainda não começou (`validoDe` no futuro).
 *   Raro; está aqui porque `validoDe` é uma coluna real e uma função que
 *   recebe uma data e a ignora é pior que uma que a usa. Dizer "válido" sobre
 *   um certificado que a SEFAZ recusaria hoje seria errado; dizer "ainda não
 *   vigente" nunca é.
 * - `valido` — vigente e com mais de {@link LIMIAR_AVISO_VENCIMENTO_DIAS}
 *   dias pela frente.
 * - `vencendo` — vigente, mas dentro do limiar. É o aviso que A11 existe para
 *   dar.
 * - `vencido` — o prazo passou. A filial não emite mais nota.
 */
export type CertificadoStatus =
  | "sem_certificado"
  | "nao_vigente"
  | "valido"
  | "vencendo"
  | "vencido";

/**
 * A quantos dias do vencimento o aviso acende: **30**.
 *
 * O número não é convenção copiada — é o tamanho do ciclo de renovação de um
 * A1, com folga para o operador que não abre o ERP todo dia:
 *
 * 1. **Renovar não é baixar um arquivo.** É comprar na Autoridade
 *    Certificadora, **agendar** a validação (presencial ou por
 *    videoconferência, exigida pelo ICP-Brasil), passar por ela, só então
 *    emitir e baixar — e depois ainda cadastrar na Focus. O agendamento é o
 *    gargalo: ele é marcado com dias de antecedência, não na hora.
 * 2. **A assimetria de custo é brutal.** Avisar cedo demais custa uma faixa
 *    de texto na tela. Avisar tarde demais custa a operação inteira: sem
 *    certificado válido a filial **para** de emitir nota — não é
 *    funcionalidade degradada, é o faturamento parado. Diante dessa
 *    assimetria, errar para o lado generoso é a escolha óbvia.
 * 3. **30 dias é ~8% da vida de um A1** (que vale 1 ano). Curto o bastante
 *    para o aviso significar alguma coisa quando aparece — um limiar de 90
 *    dias deixaria a faixa acesa um trimestre inteiro, e faixa sempre acesa
 *    vira parte do papel de parede. Longo o bastante para sobreviver a duas
 *    semanas de férias do único operador da loja, que 7 ou 15 dias não
 *    sobrevivem.
 *
 * Não há um segundo limiar mais gritante (tipo "faltam 3 dias"): `vencido` já
 * é o segundo nível, e dois limiares antes dele seriam três tons de aviso
 * para uma decisão que só tem duas respostas — renovar agora ou não.
 */
export const LIMIAR_AVISO_VENCIMENTO_DIAS = 30;

/**
 * `YYYY-MM-DD` → o instante UTC daquele dia, ou `null` se a string não for
 * uma data de calendário de verdade.
 *
 * UTC, e não fuso local, porque a conta que interessa é de **dias inteiros**:
 * em fuso local a diferença entre duas meia-noites atravessa horário de verão
 * e vira 23 ou 25 horas, e uma divisão por 24h passa a devolver 29,96 dias
 * onde deveria devolver 30 — bem em cima do limiar.
 *
 * A conferência de volta (`getUTCFullYear` etc.) existe porque `Date.UTC`
 * **normaliza em silêncio**: `2026-02-31` viraria 3 de março em vez de erro.
 */
function diaUtc(iso: string): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const ts = Date.UTC(ano, mes - 1, dia);
  const conferencia = new Date(ts);
  if (
    conferencia.getUTCFullYear() !== ano ||
    conferencia.getUTCMonth() !== mes - 1 ||
    conferencia.getUTCDate() !== dia
  ) {
    return null;
  }
  return ts;
}

const UM_DIA_MS = 86_400_000;

/**
 * Dias inteiros entre hoje e o fim da validade. `0` = vence hoje (e hoje o
 * certificado ainda vale — o prazo é o dia todo); negativo = já venceu;
 * `null` = não há data, ou ela não é uma data.
 */
export function diasAteVencimento(
  validoAte: string | null,
  hojeIso: string = todayIso(),
): number | null {
  if (!validoAte) return null;
  const fim = diaUtc(validoAte);
  const hoje = diaUtc(hojeIso);
  if (fim === null || hoje === null) return null;
  return Math.round((fim - hoje) / UM_DIA_MS);
}

/**
 * O status derivado, a partir das datas.
 *
 * **`validoAte` é a âncora**: sem ela o status é `sem_certificado`, mesmo que
 * as outras duas colunas tenham conteúdo. É a única das três sobre a qual dá
 * para agir, e a Focus devolve as três juntas — uma sem a outra só acontece
 * se alguém editar o banco à mão.
 *
 * **Data ilegível também cai em `sem_certificado`**, e essa é a direção
 * segura: sem conseguir ler a data não dá para avisar de nada, e "sem
 * certificado" empurra o operador para a ação certa (cadastrar de novo),
 * enquanto "válido" o deixaria confiante em cima de um dado corrompido.
 *
 * A ordem das perguntas importa: **`vencido` vem antes de `nao_vigente`**. Um
 * certificado com as duas coisas ao mesmo tempo é dado sem sentido, e entre
 * "já passou" e "ainda não começou" a primeira é a que para a emissão.
 */
export function certificadoStatus(
  cert: BranchCertificado,
  hojeIso: string = todayIso(),
): CertificadoStatus {
  const dias = diasAteVencimento(cert.validoAte, hojeIso);
  if (dias === null) return "sem_certificado";
  if (dias < 0) return "vencido";

  const inicio = cert.validoDe ? diaUtc(cert.validoDe) : null;
  const hoje = diaUtc(hojeIso);
  if (inicio !== null && hoje !== null && inicio > hoje) return "nao_vigente";

  return dias <= LIMIAR_AVISO_VENCIMENTO_DIAS ? "vencendo" : "valido";
}

/**
 * Relação entre o CNPJ da filial e o CNPJ que está dentro do certificado.
 *
 * **Comparar os 14 dígitos seria errado, e o erro seria alarme falso em
 * massa.** Um certificado e-CNPJ da matriz assina nota das filiais: o que se
 * exige é que a **raiz** (os 8 primeiros dígitos) do certificado bata com a do
 * emitente, não o CNPJ inteiro. A própria Focus documenta esse desenho ao
 * explicar `certificado_especifico`: sem ele, "atualização de certificado é
 * propagada para todas empresas com o mesmo CNPJ base (matriz e filiais)" — o
 * que só faz sentido porque o mesmo certificado serve as duas.
 *
 * Daí os quatro resultados, e só `divergente` é problema:
 *
 * - `indeterminada` — falta um dos dois, ou algum não tem 14 dígitos. Não dá
 *   para afirmar nada, e um aviso baseado em nada é ruído.
 * - `mesma_empresa` — os 14 dígitos batem.
 * - `mesma_raiz` — a raiz bate e o sufixo não: é o certificado da matriz
 *   servindo esta filial. **Normal, e não gera aviso.**
 * - `divergente` — a raiz não bate. Este certificado não assina nota desta
 *   filial.
 */
export type CertificadoCnpjRelacao =
  | "indeterminada"
  | "mesma_empresa"
  | "mesma_raiz"
  | "divergente";

export function relacaoCnpjCertificado(
  cnpjFilial: string | null,
  cnpjCertificado: string | null,
): CertificadoCnpjRelacao {
  const filial = onlyDigits(cnpjFilial ?? "");
  const certificado = onlyDigits(cnpjCertificado ?? "");
  if (filial.length !== 14 || certificado.length !== 14) return "indeterminada";
  if (filial === certificado) return "mesma_empresa";
  return filial.slice(0, 8) === certificado.slice(0, 8) ? "mesma_raiz" : "divergente";
}

/**
 * Tudo o que a tela precisa mostrar sobre o certificado, já resolvido — para
 * que a ficha, a lista e o formulário digam **a mesma coisa** sem cada um
 * remontar a frase do seu jeito.
 */
export type CertificadoResumo = {
  status: CertificadoStatus;
  /** Rótulo curto, para a coluna da lista e a linha da ficha. */
  rotulo: string;
  /** Frase com as datas, para a ficha e o formulário. */
  detalhe: string;
  /** O que precisa aparecer em destaque, ou `null` quando não há o que avisar. */
  aviso: string | null;
  diasAteVencimento: number | null;
  relacaoCnpj: CertificadoCnpjRelacao;
};

/** "vence hoje" / "vence amanhã" / "vence em N dias" / "venceu há N dias". */
function frasePrazo(dias: number): string {
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias > 1) return `vence em ${dias} dias`;
  const passados = Math.abs(dias);
  return passados === 1 ? "venceu ontem" : `venceu há ${passados} dias`;
}

const ROTULOS_CERTIFICADO: Record<CertificadoStatus, string> = {
  sem_certificado: "Não cadastrado",
  nao_vigente: "Ainda não vigente",
  valido: "Válido",
  vencendo: "Vence em breve",
  vencido: "Vencido",
};

/** Rótulo curto do status, sem as datas. */
export function certificadoStatusLabel(status: CertificadoStatus): string {
  return ROTULOS_CERTIFICADO[status];
}

/**
 * Resumo pronto para a tela.
 *
 * O aviso de CNPJ divergente é **acumulado**, não excludente: um certificado
 * pode estar vencido *e* ser de outra empresa, e mostrar só um dos dois
 * esconderia metade do problema justamente de quem está tentando consertá-lo.
 */
export function resumoCertificado(
  cert: BranchCertificado,
  cnpjFilial: string | null,
  hojeIso: string = todayIso(),
): CertificadoResumo {
  const status = certificadoStatus(cert, hojeIso);
  const dias = diasAteVencimento(cert.validoAte, hojeIso);
  const relacaoCnpj = relacaoCnpjCertificado(cnpjFilial, cert.cnpj);

  /*
   * O aviso de CNPJ vale mesmo sem validade cadastrada — um `certificado_cnpj`
   * gravado sem data é dado editado à mão, e apontar a empresa errada continua
   * sendo a informação mais útil que dá para dar sobre ele.
   */
  const avisos: string[] =
    relacaoCnpj === "divergente"
      ? [
          `O certificado é do CNPJ ${formatCnpj(cert.cnpj ?? "")}, que não tem a mesma raiz do ` +
            "CNPJ desta filial. Nota assinada por certificado de outra empresa é recusada.",
        ]
      : [];

  const fechar = (detalhe: string): CertificadoResumo => ({
    status,
    rotulo: ROTULOS_CERTIFICADO[status],
    detalhe,
    aviso: avisos.length > 0 ? avisos.join(" ") : null,
    diasAteVencimento: dias,
    relacaoCnpj,
  });

  /*
   * `dias === null` é exatamente a condição de `sem_certificado` (é assim que
   * `certificadoStatus` o decide), e sair aqui é o que deixa `dias` ser um
   * `number` daqui para baixo. A alternativa — seguir em frente com um
   * `dias ?? 0` em cada uso — imprimiria "vence hoje" para um certificado cuja
   * data não deu para ler, que é a mensagem mais alarmante possível justamente
   * onde não se sabe de nada.
   */
  if (dias === null) {
    return fechar("Nenhum certificado digital cadastrado para esta filial.");
  }

  const de = formatDateOnly(cert.validoDe);
  const ate = formatDateOnly(cert.validoAte);
  const prazo = frasePrazo(dias);

  if (status === "vencido") {
    avisos.unshift(
      `O certificado digital desta filial ${prazo} (${ate}). ` +
        "Enquanto ele não for renovado, a filial não emite nota fiscal.",
    );
  } else if (status === "vencendo") {
    avisos.unshift(
      `O certificado digital desta filial ${prazo} (${ate}). ` +
        "Renovar um A1 exige comprar na Autoridade Certificadora e agendar a validação — " +
        "comece agora, não no dia.",
    );
  } else if (status === "nao_vigente") {
    avisos.unshift(
      `O certificado digital desta filial só passa a valer em ${de}. ` +
        "Até lá a filial não emite nota fiscal.",
    );
  }

  return fechar(de ? `Válido de ${de} a ${ate} — ${prazo}.` : `Válido até ${ate} — ${prazo}.`);
}

/**
 * O texto que a tela mostra no lugar dos campos de envio do certificado.
 *
 * **Por que os campos nascem desabilitados, e não "habilitados e recusados no
 * confirmar".** As duas opções deixam o operador sem enviar o certificado —
 * não existe conta na Focus (A12 não aconteceu), então não há destino. A
 * diferença está no que acontece com a senha nesse meio-tempo: no caminho
 * "habilitado", ela é digitada e passa a existir em memória do navegador, no
 * gerenciador de senhas se ele se oferecer para guardá-la, e em qualquer lugar
 * para onde a memória do processo possa ir — em troca de **função zero**,
 * porque a confirmação recusa de qualquer jeito. É risco sem contrapartida.
 *
 * Desabilitado, a propriedade "a senha do certificado nunca entra neste
 * sistema" deixa de depender de cuidado (limpar estado, cuidar do desmonte,
 * não logar) e passa a ser **estrutural**: não há estado para vazar, porque
 * não há como digitar. `BranchFormValues` também não ganhou campo nenhum de
 * certificado — não existe casa para o valor nem no formulário nem na
 * tradução para colunas.
 *
 * Esconder os campos seria pior, e essa decisão não é nova: D1 enfrentou a
 * mesma escolha com o e-mail de cópia da nota e resolveu do mesmo jeito —
 * "aparece desabilitado com a explicação, não escondido", porque sumir seria a
 * tela escondendo do operador que o cadastro tem essa casa.
 */
export const MOTIVO_CERTIFICADO_DESLIGADO =
  "O envio do certificado digital ainda não está disponível: a integração com a Focus (A12) " +
  "não foi construída, e não existe conta lá para onde mandar o arquivo. Quando ela existir, " +
  "o arquivo e a senha vão do seu navegador direto para a Focus — este sistema não guarda " +
  "nenhum dos dois, em lugar nenhum, nem por um instante.";
