/** Tipo do lançamento — permanente: nasce a pagar ou a receber e não muda. */
export type FinanceEntryType = "a_pagar" | "a_receber";

/** Situação do lançamento — é isto que a baixa muda. */
export type FinanceEntryStatus = "aberto" | "baixado" | "cancelado";

/** De onde o lançamento veio — 'manual' é o formulário; os demais são gerados por outro módulo. */
export type FinanceOriginKind = "manual" | "venda" | "compra" | "devolucao";

/**
 * Aba da tela. Não é o mesmo que `FinanceEntryType`: "baixados" não é um
 * terceiro tipo de lançamento, é um filtro por `status` que junta os dois
 * tipos. As abas em si vêm de `module_tabs` (motor genérico) — este tipo só
 * nomeia as chaves que a página sabe traduzir em filtro.
 */
export type FinanceTab = "a-pagar" | "a-receber" | "baixados";

/**
 * Uma linha do Financeiro. As chaves em camelCase são os `accessorKey` que o
 * motor genérico lê a partir de `module_fields` (`due_date` -> `dueDate`) —
 * mudar um nome aqui exige mudar a linha correspondente em `module_fields`.
 *
 * Alguns acessores existem só para a tela e não são colunas de
 * `financial_entries`: `contactName` (join com `contacts`), `operatorName`
 * (join com `profiles`), `installment` ("1/3"), e os `*Formatted`. O motor
 * renderiza tudo com `String(valor)`, então o que precisa aparecer formatado
 * já chega formatado — os campos crus (`total`, `dueDate`, `issueDate`)
 * continuam existindo porque são eles que voltam para o formulário de edição.
 */
export type FinanceEntry = {
  id: string;
  code: string;
  type: FinanceEntryType;
  status: FinanceEntryStatus;
  contactId?: string;
  contactName: string;
  paymentMethod: string;
  installmentNumber: number;
  installmentTotal: number;
  installment: string;
  /** Igual em todas as parcelas da mesma operação, inclusive parcela única. */
  installmentGroupId: string;
  originKind: FinanceOriginKind;
  originId?: string;
  total: number;
  totalFormatted: string;
  document: string;
  /** ISO (`2026-08-20`) — é o que o `<input type="date">` do formulário espera. */
  dueDate: string;
  dueDateFormatted: string;
  issueDate: string;
  issueDateFormatted: string;
  changedAt: string;
  operatorName: string;
  settledAt?: string;
  settledAtFormatted: string;
};

/**
 * O que se edita num lançamento já existente — uma parcela por vez, nunca o
 * grupo inteiro. Não inclui `type`/`installmentNumber`/`installmentTotal`/
 * origem: são estruturais, decididos na criação (função de parcelamento) e
 * bloqueados por gatilho no banco se alguém tentar mudá-los por aqui.
 */
export type FinanceEntryEditInput = {
  contactId?: string | null;
  paymentMethod?: string;
  total?: number;
  document?: string;
  dueDate?: string;
  issueDate?: string;
};

/**
 * O que o formulário de criação (parcelamento) envia pra RPC
 * `create_financial_entry_installments`. Uma operação inteira, não uma
 * parcela — daí `total` ser o valor da operação e não de uma linha.
 */
export type FinanceEntryPlanInput = {
  type: FinanceEntryType;
  contactId?: string | null;
  paymentMethod?: string;
  document?: string;
  total: number;
  installmentCount: number;
  firstDueDate: string;
  intervalDays: number;
  settled: boolean;
};

export type InstallmentPreviewItem = {
  number: number;
  dueDate: string;
  dueDateFormatted: string;
  amount: number;
  amountFormatted: string;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatEntryTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type CashFlowTotals = { entrou: number; saiu: number; saldo: number };

/**
 * Entrou (a_receber) / Saiu (a_pagar) / Saldo de um conjunto de lançamentos —
 * a mesma conta que a aba "Baixados" do Financeiro já faz. Extraída daqui
 * (em vez de inline em `FinancePage.tsx`) porque o relatório "Financeiro
 * (fluxo de caixa)" (etapa 11) precisa do mesmo número e não deve reinventar
 * a soma — as duas telas chamam esta função sobre o recorte de lançamentos
 * que cada uma decide mostrar (aba "Baixados" ali, intervalo de datas aqui).
 */
export function computeCashFlowTotals(entries: Pick<FinanceEntry, "type" | "total">[]): CashFlowTotals {
  const entrou = entries.filter((entry) => entry.type === "a_receber").reduce((sum, entry) => sum + entry.total, 0);
  const saiu = entries.filter((entry) => entry.type === "a_pagar").reduce((sum, entry) => sum + entry.total, 0);
  return { entrou, saiu, saldo: entrou - saiu };
}

/**
 * `date` do Postgres chega como "2026-08-20". Formatar via `new Date(...)`
 * interpretaria isso como meia-noite UTC e mostraria o dia anterior no fuso
 * do Brasil — por isso a conversão é feita na string, sem passar por `Date`.
 */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

/** `timestamptz` (criação, alteração, baixa) — aí sim o fuso local é o certo. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Data de hoje em ISO (`YYYY-MM-DD`) — comparável por string com `dueDate`. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Converte um campo de valor (texto, vírgula decimal) em número — sem
 * mascarar erro de digitação como zero. `null` = vazio ou não numérico; o
 * chamador decide se isso é erro (é sempre erro para "Valor total", mas o
 * parser em si não assume isso). Esta é a correção do bug em que "abc"
 * virava R$ 0,00 em silêncio: antes, o fallback numérico escondia o erro.
 */
export function parseAmount(value: string | undefined): number | null {
  if (!value || !value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Mensagem de erro pronta para "Valor total" — não numérico ou <= 0. */
export function validateAmount(value: string | undefined, label = "Valor total"): string | null {
  const amount = parseAmount(value);
  if (amount === null) return `${label} precisa ser um número válido.`;
  if (amount <= 0) return `${label} precisa ser maior que zero.`;
  return null;
}

/** `validate` do `RegistryFormModal` para o formulário de edição de um lançamento. */
export function validateFinanceEntryEditValues(values: Record<string, string>): string[] {
  const errors: string[] = [];
  const totalError = validateAmount(values.total, "Valor total");
  if (totalError) errors.push(totalError);
  return errors;
}

/** Monta o patch de edição a partir dos valores (texto) do `RegistryFormModal`. */
export function buildFinanceEntryEditInput(
  values: Record<string, string>,
  contactId: string | null,
): FinanceEntryEditInput {
  return {
    contactId: contactId ?? undefined,
    paymentMethod: values.paymentMethod || undefined,
    total: parseAmount(values.total) ?? undefined,
    document: values.document || undefined,
    dueDate: values.dueDate,
    issueDate: values.issueDate || undefined,
  };
}

/**
 * Replica a matemática de arredondamento da RPC
 * `financial_entries_create_installments` (centavos inteiros, sobra na
 * primeira parcela) — a prévia no formulário precisa bater exatamente com o
 * que o banco vai gravar, ou o usuário só descobriria o arredondamento
 * depois de salvar.
 */
export function computeInstallmentPreview(
  total: number,
  installmentCount: number,
  firstDueDate: string,
  intervalDays: number,
): InstallmentPreviewItem[] {
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / installmentCount);
  const remainderCents = totalCents - baseCents * installmentCount;

  const [year, month, day] = firstDueDate.split("-").map(Number);
  const baseDate = new Date(Date.UTC(year, month - 1, day));

  const items: InstallmentPreviewItem[] = [];
  for (let i = 1; i <= installmentCount; i += 1) {
    const cents = baseCents + (i === 1 ? remainderCents : 0);
    const amount = cents / 100;

    const dueDate = new Date(baseDate);
    dueDate.setUTCDate(dueDate.getUTCDate() + (i - 1) * intervalDays);
    const dueDateIso = dueDate.toISOString().slice(0, 10);

    items.push({
      number: i,
      dueDate: dueDateIso,
      dueDateFormatted: formatDateOnly(dueDateIso),
      amount,
      amountFormatted: formatEntryTotal(amount),
    });
  }
  return items;
}
