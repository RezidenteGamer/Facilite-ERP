import { supabase } from "../supabaseClient";
import type { TablesInsert, TablesUpdate } from "../../types/supabase";
import {
  branchColumnsFromForm,
  COLUNA_CERT_CNPJ,
  COLUNA_CERT_VALIDO_ATE,
  COLUNA_CERT_VALIDO_DE,
  COLUNA_EMAIL_COPIA_NOTA,
  COLUNAS_CERTIFICADO,
  isDuplicateBranchCodeError,
  isMissingColumnError,
  type BranchAdmin,
  type BranchFormValues,
} from "../../features/settings/branches";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

/** Lê só o padrão de estoque negativo de uma filial — usado em Configurações e em Produtos (valor efetivo herdado). */
export async function fetchBranchAllowsNegativeStock(branchId: string): Promise<boolean> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .select("allow_negative_stock")
    .eq("id", branchId)
    .single();
  if (error) throw error;
  return data.allow_negative_stock;
}

/** Grava o padrão de estoque negativo da filial. Exige `can_manage_branches` (RLS de `branches update`). */
export async function updateBranchAllowsNegativeStock(branchId: string, allow: boolean): Promise<void> {
  const client = assertSupabase();
  const { error } = await client.from("branches").update({ allow_negative_stock: allow }).eq("id", branchId);
  if (error) throw error;
}

/**
 * Lê o `pCredSN` da filial — a alíquota de crédito de ICMS do Simples Nacional
 * (B8, 03/09/2026). Nula quando ninguém cadastrou.
 *
 * O número mora na filial, e não no grupo tributário, porque é o percentual
 * efetivo de ICMS da faixa de RBT12 **dela** — ver a decisão de B8 no
 * AGENTS.md. Quem o usa de verdade é a Edge Function `fiscal-emit`, que o lê do
 * banco na hora de montar a nota; este par de funções existe para
 * Configurações ter como cadastrá-lo pela filial ativa — ver o comentário de
 * `SimplesCreditSection` sobre por que ele não foi para o formulário de filial
 * que D1 criou.
 */
export async function fetchBranchSimplesCreditRate(branchId: string): Promise<number | null> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .select("aliquota_credito_icms_simples")
    .eq("id", branchId)
    .single();
  if (error) throw error;
  return data.aliquota_credito_icms_simples;
}

/** Grava o `pCredSN` da filial (`null` limpa). Exige `can_manage_branches`. */
export async function updateBranchSimplesCreditRate(branchId: string, rate: number | null): Promise<void> {
  const client = assertSupabase();
  const { error } = await client
    .from("branches")
    .update({ aliquota_credito_icms_simples: rate })
    .eq("id", branchId);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * Cadastro de filiais (D1, 09/09/2026)
 *
 * Até aqui este arquivo só sabia ler e escrever **um parâmetro por vez** da
 * filial ativa, porque era o que Configurações precisava. D1 acrescenta o
 * cadastro inteiro: listar, criar e editar — o que antes só existia por SQL.
 *
 * Quem impõe o acesso continua sendo a RLS, não estas funções:
 * `read accessible branches` (select) libera `has_branch_access(id) or
 * can_manage_branches()`, e as três policies de escrita exigem
 * `can_manage_branches()`. A tela desabilita botão; o banco é que recusa.
 * ------------------------------------------------------------------ */

const COLUNAS_BASE =
  "id, code, name, cnpj, active, inscricao_estadual, regime_tributario, cnae, " +
  "codigo_ibge_municipio, logradouro, numero, bairro, municipio, uf, cep, allow_negative_stock";

/**
 * Colunas que podem ou não existir neste banco, **agrupadas pela migration que
 * as cria**.
 *
 * **Isto não é paranoia genérica sobre schema**: são duas migrations escritas
 * por sessões sem permissão de aplicá-las (D1 e A11), então o estado normal
 * deste código é rodar contra um banco onde nenhuma das duas existe. Sem a
 * sondagem, o `select` inteiro falharia e a tela de Filiais não listaria nada.
 *
 * **Por que grupos, e não um booleano como em D1.** Um `42703` diz "alguma
 * coluna deste `select` não existe" — e não diz qual. Com uma migration
 * pendente só, dava para deduzir; com duas, que podem ser aplicadas em ordens
 * diferentes, deduzir vira chute: marcar as duas como ausentes esconderia o
 * certificado num banco que já tem a coluna dele, e marcar as duas como
 * presentes deixaria a tela sem listar nada. Por isso, diante do `42703`, o
 * código pergunta grupo a grupo em vez de adivinhar.
 *
 * **Condição de remoção**: quando as duas migrations estiverem aplicadas em
 * todos os ambientes, este estado, o caminho de sondagem de
 * `fetchBranchesForAdmin` e os dois `...ColumnsAvailable` que atravessam o
 * hook, a tela e a ficha saem juntos — as colunas entram em `COLUNAS_BASE` e
 * pronto. Não é para ficar.
 */
const GRUPOS_OPCIONAIS = {
  /** `00000000000014_d1_filiais_ganham_tela.sql` */
  email: [COLUNA_EMAIL_COPIA_NOTA] as readonly string[],
  /** `00000000000015_a11_certificado_digital_validade.sql` */
  certificado: COLUNAS_CERTIFICADO as readonly string[],
} as const;

type GrupoOpcional = keyof typeof GRUPOS_OPCIONAIS;

const GRUPOS = Object.keys(GRUPOS_OPCIONAIS) as GrupoOpcional[];

/** `null` = ainda não sondado; `true`/`false` = existe / não existe. */
const disponibilidade: Record<GrupoOpcional, boolean | null> = {
  email: null,
  certificado: null,
};

/** A coluna de e-mail está disponível? `null` enquanto ninguém listou ainda. */
export function branchEmailColumnAvailable(): boolean | null {
  return disponibilidade.email;
}

/**
 * As três colunas de certificado digital (A11) estão disponíveis? `null`
 * enquanto ninguém listou ainda.
 */
export function branchCertificadoColumnsAvailable(): boolean | null {
  return disponibilidade.certificado;
}

/** Os grupos que vale a pena tentar — os que não são sabidamente ausentes. */
function gruposCandidatos(): GrupoOpcional[] {
  return GRUPOS.filter((grupo) => disponibilidade[grupo] !== false);
}

/** `COLUNAS_BASE` mais as colunas dos grupos pedidos. */
function selectCom(grupos: GrupoOpcional[]): string {
  return [COLUNAS_BASE, ...grupos.flatMap((grupo) => GRUPOS_OPCIONAIS[grupo])].join(", ");
}

type LinhaFilial = Record<string, unknown>;

function toBranchAdmin(row: LinhaFilial): BranchAdmin {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    cnpj: (row.cnpj as string | null) ?? null,
    active: Boolean(row.active),
    inscricaoEstadual: (row.inscricao_estadual as string | null) ?? null,
    regimeTributario: (row.regime_tributario as string | null) ?? null,
    cnae: (row.cnae as string | null) ?? null,
    codigoIbgeMunicipio: (row.codigo_ibge_municipio as string | null) ?? null,
    logradouro: (row.logradouro as string | null) ?? null,
    numero: (row.numero as string | null) ?? null,
    bairro: (row.bairro as string | null) ?? null,
    municipio: (row.municipio as string | null) ?? null,
    uf: (row.uf as string | null) ?? null,
    cep: (row.cep as string | null) ?? null,
    allowNegativeStock: Boolean(row.allow_negative_stock),
    emailCopiaNotaFiscal: (row[COLUNA_EMAIL_COPIA_NOTA] as string | null) ?? null,
    certificadoValidoDe: (row[COLUNA_CERT_VALIDO_DE] as string | null) ?? null,
    certificadoValidoAte: (row[COLUNA_CERT_VALIDO_ATE] as string | null) ?? null,
    certificadoCnpj: (row[COLUNA_CERT_CNPJ] as string | null) ?? null,
  };
}

/**
 * Colunas físicas a partir dos valores do formulário.
 *
 * `includeEmail` é `colunaEmailDisponivel !== false`, e **não** a checagem de
 * verdade do estado: um `null` (a listagem falhou, ninguém sondou ainda)
 * significa "não sei", e diante de "não sei" é melhor tentar gravar e receber
 * um erro visível do que descartar em silêncio um e-mail que o operador
 * digitou num campo que estava habilitado.
 */
function toColunas(values: BranchFormValues): Record<string, unknown> {
  return branchColumnsFromForm(values, { includeEmail: disponibilidade.email !== false });
}

/** Mensagem do banco traduzida quando dá para dizer algo melhor que o texto cru. */
function erroDeEscrita(error: { code?: string; message?: string }): Error {
  if (isDuplicateBranchCodeError(error)) {
    return new Error("Já existe uma filial com esse código. O código é único no sistema.");
  }
  return new Error(error.message ?? "Erro ao salvar a filial.");
}

/**
 * Todas as filiais que a RLS deixa este usuário enxergar, ordenadas por código.
 *
 * Quem tem `can_manage_branches` vê todas; quem não tem vê só as suas
 * (`has_branch_access`). Isso é imposição do banco — a tela não filtra nada.
 */
export async function fetchBranchesForAdmin(): Promise<BranchAdmin[]> {
  const client = assertSupabase();

  const candidatos = gruposCandidatos();
  if (candidatos.length > 0) {
    /* Caminho feliz e caminho já sondado: uma requisição só, e ela é a própria
       sondagem — custo zero quando o schema está em dia. */
    const { data, error } = await client
      .from("branches")
      .select(selectCom(candidatos))
      .order("code", { ascending: true });

    if (!error) {
      for (const grupo of candidatos) disponibilidade[grupo] = true;
      return ((data ?? []) as unknown as LinhaFilial[]).map(toBranchAdmin);
    }
    if (!isMissingColumnError(error)) throw error;

    /* Alguma coluna opcional não existe, e o erro não diz qual. Uma pergunta
       por grupo — em paralelo, porque são independentes — e uma única vez na
       sessão. */
    const sondas = await Promise.all(
      candidatos.map(async (grupo) => ({
        grupo,
        error: (await client.from("branches").select(GRUPOS_OPCIONAIS[grupo].join(", ")).limit(1))
          .error,
      })),
    );
    for (const sonda of sondas) {
      if (sonda.error && !isMissingColumnError(sonda.error)) throw sonda.error;
      disponibilidade[sonda.grupo] = !sonda.error;
    }

    /* Todas as sondas passaram, mas o `select` com elas falhou: quem não
       existe é uma coluna de `COLUNAS_BASE`, e não uma das opcionais. Repetir
       o mesmo `select` só gastaria mais uma ida ao banco para receber o mesmo
       erro — melhor devolver o original, que é o que descreve o problema de
       verdade. */
    if (gruposCandidatos().length === candidatos.length) throw error;
  }

  const { data, error } = await client
    .from("branches")
    .select(selectCom(gruposCandidatos()))
    .order("code", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as LinhaFilial[]).map(toBranchAdmin);
}

/**
 * Cria uma filial. Exige `can_manage_branches` (policy `manage branches insert`).
 *
 * O `.select().single()` no fim **não é enfeite** e não está lá pelo valor de
 * retorno (quem chama relê a lista): ele é o que transforma uma escrita que a
 * RLS recusou sem erro — zero linha afetada, resposta 200 — em erro de
 * verdade. Sem ele, um `update` barrado pela policy pareceria ter dado certo.
 */
export async function createBranch(values: BranchFormValues): Promise<BranchAdmin> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .insert(toColunas(values) as TablesInsert<"branches">)
    .select()
    .single();
  if (error) throw erroDeEscrita(error);
  return toBranchAdmin(data as unknown as LinhaFilial);
}

/** Edita uma filial. Exige `can_manage_branches` (policy `manage branches update`). */
export async function updateBranch(id: string, values: BranchFormValues): Promise<BranchAdmin> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("branches")
    .update(toColunas(values) as TablesUpdate<"branches">)
    .eq("id", id)
    .select()
    .single();
  if (error) throw erroDeEscrita(error);
  return toBranchAdmin(data as unknown as LinhaFilial);
}
