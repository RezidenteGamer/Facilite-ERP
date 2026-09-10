import { isValidCnpj } from "../../lib/fiscal/cpfCnpj";
import { onlyDigits, resolveUfCode } from "../../lib/fiscal/accessKey";

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
