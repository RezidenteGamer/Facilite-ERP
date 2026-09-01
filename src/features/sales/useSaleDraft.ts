import { useEffect, useMemo, useState } from "react";
import { useOpenWindows } from "../../components/openWindows";
import { parseAmount } from "../../lib/amount";
import { formatContactAddress, type Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createSale, type CreateSaleInput } from "../../lib/repositories/salesRepository";
import { emitInvoiceForSale, type EmitOutcome } from "../../lib/repositories/fiscalDocumentsRepository";
import { formatMoney, type SalePaymentMethod, type Sale } from "./sales";
import type { SaleSeller } from "../../lib/repositories/salesLookups";

export type SaleHeaderForm = {
  clienteId: string;
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  endereco: string;
  enderecoEntrega: string;
  tipoOperacao: string;
  departamento: string;
  centroCustos: string;
  dataEmissao: string;
  dataSaida: string;
  /** Vencimento da 1ª parcela e intervalo entre elas — só usados quando há pagamento parcelado (crédito/boleto). */
  firstDueDate: string;
  intervalDays: number;
};

function addDaysIso(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

/** Formas que a RPC trata como "recebe depois", com N parcelas — ver `create_sale`. */
const INSTALLMENT_METHODS: SalePaymentMethod[] = ["credito", "boleto"];

/**
 * O vendedor nasce preenchido com quem está logado — na prática é quase
 * sempre a mesma pessoa operando o caixa, então obrigar a escolher toda
 * venda era um clique inútil repetido dezenas de vezes por dia. Continua
 * trocável pela lupa (ex.: outro operador processando a venda), e o campo
 * segue existindo no banco como obrigatório — só deixou de exigir escolha
 * manual.
 */
function buildHeaderInicial(defaultSeller?: SaleSeller | null): SaleHeaderForm {
  return {
    clienteId: "",
    clienteNome: "",
    vendedorId: defaultSeller?.id ?? "",
    vendedorNome: defaultSeller?.name ?? "",
    endereco: "",
    enderecoEntrega: "",
    tipoOperacao: "",
    departamento: "",
    centroCustos: "",
    dataEmissao: new Date().toISOString().slice(0, 10),
    dataSaida: "",
    firstDueDate: addDaysIso(30),
    intervalDays: 30,
  };
}

export type CartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type PaymentLine = {
  lineId: string;
  method: SalePaymentMethod;
  amount: number;
  installments: number;
};

/**
 * Erro de confirmação da venda. Texto puro nos casos genéricos; a forma
 * estruturada só aparece para o erro de estoque insuficiente, que tem "para
 * onde ir" — ver `ActionableMessage` e `ConfirmacaoStep.tsx`.
 */
export type SaleSubmitError =
  | string
  | {
      message: string;
      action: { label: string; to: string };
    };

function lineTotal(line: CartLine) {
  return Math.max(0, line.quantity * line.unitPrice - line.discountAmount);
}

/** Última linha removida (item do carrinho ou pagamento) — permite "Desfazer" por alguns segundos. */
type RemovedEntry =
  | { kind: "cart"; line: CartLine; index: number }
  | { kind: "payment"; line: PaymentLine; index: number };

const UNDO_TIMEOUT_MS = 6000;

const STOCK_ERROR = /^Estoque insuficiente para o produto ([0-9a-f-]{36})\.$/i;
const PAYMENTS_MISMATCH_ERROR = /^A soma dos pagamentos \(([\d.,-]+)\) não bate com o total da venda \(([\d.,-]+)\)\.$/;
/** `assert_discount_within_cap` (tarefa C3, 29/08/2026) — teto de `roles.max_discount_percent`. */
const DISCOUNT_CAP_ERROR = /^Desconto de ([\d.,]+)% acima do limite do seu perfil \(([\d.,]+)%\)\.$/;

/**
 * A RPC `create_sale` já levanta mensagens em português para as regras de
 * negócio que ela mesma valida (permissão, filial, item/pagamento
 * obrigatório, produto, estoque, pagamentos batendo com o total) — não
 * precisamos reescrevê-las. Só tratamos dois casos: (1) o erro de estoque
 * cita o produto pelo id (a função só tem o id em mãos, não o nome) — aqui
 * no cliente já temos o carrinho, então trocamos pelo nome; (2) qualquer
 * erro que a RPC não previu (queda de conexão, etc.) cai num texto genérico
 * em vez de mostrar o objeto de erro cru pro operador.
 */
function extractErrorMessage(err: unknown, cart: CartLine[]): SaleSubmitError {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";

  const stockMatch = raw.match(STOCK_ERROR);
  if (stockMatch) {
    const line = cart.find((l) => l.product.id === stockMatch[1]);
    if (!line) return "Estoque insuficiente para um dos produtos da venda.";
    // Só sugestão: pode ter mudado entre o carregamento do carrinho e a
    // tentativa de venda, então nunca deixa negativo/zero virar mensagem.
    const missing = line.quantity - line.product.stock;
    const message =
      missing > 0
        ? `Estoque insuficiente para "${line.product.description}" — faltam ${missing} unidade${missing === 1 ? "" : "s"}.`
        : `Estoque insuficiente para "${line.product.description}" — reduza a quantidade ou remova o item.`;
    return {
      message,
      action: {
        label: `Ajustar estoque de ${line.product.description}`,
        to: `/ajuste-estoque?produto=${line.product.id}`,
      },
    };
  }

  const mismatchMatch = raw.match(PAYMENTS_MISMATCH_ERROR);
  if (mismatchMatch) {
    const paid = Number(mismatchMatch[1].replace(",", "."));
    const total = Number(mismatchMatch[2].replace(",", "."));
    return `A soma dos pagamentos (${formatMoney(paid)}) não bate com o total da venda (${formatMoney(total)}).`;
  }

  // A RPC já devolve a mensagem pronta em português — só repassamos,
  // sem regex, porque os valores já vêm formatados com "%" e não precisam
  // de reformatação como os casos acima (que usam formatMoney).
  if (DISCOUNT_CAP_ERROR.test(raw)) return raw;

  // Mensagens conhecidas da RPC (permissão, filial, item/pagamento obrigatório,
  // produto não encontrado/fora da filial) já vêm prontas em português — passa direto.
  const KNOWN_MESSAGES = [
    "Sem permissão para criar vendas.",
    "Sem acesso a esta filial.",
    "A venda precisa de ao menos um item.",
    "A venda precisa de ao menos uma forma de pagamento.",
    "Produto não encontrado.",
    "Produto não pertence à filial da venda.",
    "Quantidade inválida em um dos itens.",
    "Desconto do item maior que o valor do item.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";
}

/** Slot do rascunho dentro do estado da janela — ver `openWindows.tsx`. */
const DRAFT_SLOT = "sale-draft";

/**
 * O que sobrevive a uma troca de janela: só o que o operador digitou. Os
 * campos de operação em andamento (`submitting`, `submitError`,
 * `confirmedSale`, `fiscalOutcome`, `lastRemoved`) ficam de fora de
 * propósito — guardar um "enviando..." ou um erro de rede de dez minutos
 * atrás e mostrá-lo de volta descreveria um estado que não existe mais.
 */
type PersistedSaleDraft = {
  header: SaleHeaderForm;
  cart: CartLine[];
  payments: PaymentLine[];
  freight: string;
  discount: string;
};

/**
 * Estado do rascunho de uma venda em andamento: cabeçalho + carrinho + pagamentos.
 * `defaultSeller` (o operador logado) pré-preenche o Vendedor — ver `buildHeaderInicial`.
 * `windowId` é o mesmo id passado a `openWindow`: com ele o rascunho passa a
 * morar no `OpenWindowsProvider` e sobrevive a ir em outra janela e voltar.
 */
export function useSaleDraft(
  branchId: string | null,
  defaultSeller?: SaleSeller | null,
  windowId?: string | null,
) {
  const { getWindowState, setWindowState, clearWindowState } = useOpenWindows();
  // Lido uma única vez, na montagem: depois disso a fonte da verdade é o
  // `useState` daqui, e reler o que nós mesmos gravamos só daria voltas.
  const [restored] = useState(() =>
    windowId ? getWindowState<PersistedSaleDraft>(windowId, DRAFT_SLOT) : undefined,
  );

  const [header, setHeader] = useState<SaleHeaderForm>(
    () => restored?.header ?? buildHeaderInicial(defaultSeller),
  );
  const [cart, setCart] = useState<CartLine[]>(() => restored?.cart ?? []);
  const [payments, setPayments] = useState<PaymentLine[]>(() => restored?.payments ?? []);
  const [freight, setFreight] = useState(() => restored?.freight ?? "");
  const [discount, setDiscount] = useState(() => restored?.discount ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SaleSubmitError | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);
  /**
   * Resultado da emissão da nota quando `confirmSale({ emitirNota: true })` é
   * chamado — `null` quando a nota não foi pedida. Estado separado de
   * `submitError` de propósito, mesma filosofia do `fiscalWarning` do PDV
   * (`usePosSale.ts`): a venda nunca falha nem fica pendente por causa da
   * nota, então uma falha de emissão aqui é aviso, não erro de venda.
   */
  const [fiscalOutcome, setFiscalOutcome] = useState<EmitOutcome | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  // Some sozinho depois de alguns segundos — "Desfazer" não deveria ficar
  // preso na tela pro resto da venda. Cada remoção nova reinicia a contagem.
  useEffect(() => {
    if (!lastRemoved) return;
    const timer = window.setTimeout(() => setLastRemoved(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [lastRemoved]);

  /* Espelha o rascunho no estado da janela a cada mudança, para que trocar
     de janela pelo dock (uma navegação de verdade, que desmonta esta tela)
     não jogue fora o que o operador já digitou.

     A venda confirmada é o outro lado da moeda: `confirmedSale` não zera o
     rascunho (a tela de sucesso ainda mostra o que foi vendido), então, se
     este efeito continuasse gravando, abrir "Realizar Venda" de novo
     ressuscitaria a venda que acabou de ser fechada. Aqui o rascunho acaba —
     limpa em vez de gravar. A limpeza do outro fim de vida (fechar pelo "X")
     mora no `closeWindow`, porque lá a tela nem está montada. */
  useEffect(() => {
    if (!windowId) return;
    if (confirmedSale) {
      clearWindowState(windowId);
      return;
    }
    setWindowState<PersistedSaleDraft>(windowId, DRAFT_SLOT, {
      header,
      cart,
      payments,
      freight,
      discount,
    });
  }, [
    windowId,
    confirmedSale,
    header,
    cart,
    payments,
    freight,
    discount,
    setWindowState,
    clearWindowState,
  ]);

  // `profile` (fonte do `defaultSeller`) carrega de forma assíncrona — se a
  // venda já estava aberta e ninguém mexeu no campo ainda, preenche assim
  // que ele chegar. Não faz nada se o usuário já escolheu outro vendedor.
  useEffect(() => {
    if (!defaultSeller) return;
    setHeader((current) =>
      current.vendedorId ? current : { ...current, vendedorId: defaultSeller.id, vendedorNome: defaultSeller.name },
    );
  }, [defaultSeller]);

  function setField<K extends keyof SaleHeaderForm>(field: K, value: SaleHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    const endereco = formatContactAddress(contact);
    setHeader((current) => ({
      ...current,
      clienteId: contact.id,
      clienteNome: contact.name,
      endereco: endereco || current.endereco,
      enderecoEntrega: current.enderecoEntrega || endereco || "",
    }));
  }

  function selectSeller(seller: SaleSeller) {
    setHeader((current) => ({ ...current, vendedorId: seller.id, vendedorNome: seller.name }));
  }

  const headerValid = header.clienteId.trim() !== "" && header.vendedorId.trim() !== "";

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          lineId: crypto.randomUUID(),
          product,
          quantity: 1,
          unitPrice: product.salePrice,
          discountAmount: 0,
        },
      ];
    });
  }

  // `unitPrice` não entra no patch — a RPC lê o preço sempre de
  // `products.sale_price`, então deixar o tipo aceitar essa edição
  // sugeriria uma capacidade que não existe mais (tarefa C3, 29/08/2026).
  function updateLine(lineId: string, patch: Partial<Pick<CartLine, "quantity" | "discountAmount">>) {
    setCart((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeLine(lineId: string) {
    const index = cart.findIndex((line) => line.lineId === lineId);
    if (index === -1) return;
    setLastRemoved({ kind: "cart", line: cart[index], index });
    setCart((current) => current.filter((line) => line.lineId !== lineId));
  }

  function addPayment() {
    setPayments((current) => [
      ...current,
      { lineId: crypto.randomUUID(), method: "dinheiro", amount: 0, installments: 1 },
    ]);
  }

  function updatePayment(lineId: string, patch: Partial<Pick<PaymentLine, "method" | "amount" | "installments">>) {
    setPayments((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removePayment(lineId: string) {
    const index = payments.findIndex((line) => line.lineId === lineId);
    if (index === -1) return;
    setLastRemoved({ kind: "payment", line: payments[index], index });
    setPayments((current) => current.filter((line) => line.lineId !== lineId));
  }

  function undoRemove() {
    if (!lastRemoved) return;
    if (lastRemoved.kind === "cart") {
      const { line, index } = lastRemoved;
      setCart((current) => {
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, line);
        return next;
      });
    } else {
      const { line, index } = lastRemoved;
      setPayments((current) => {
        const next = [...current];
        next.splice(Math.min(index, next.length), 0, line);
        return next;
      });
    }
    setLastRemoved(null);
  }

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const freightValue = Math.max(0, parseAmount(freight) ?? 0);
  const discountValue = Math.max(0, parseAmount(discount) ?? 0);
  const total = Math.max(0, subtotal + freightValue - discountValue);
  const paymentsTotal = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const paymentsMatch = cart.length > 0 && Math.abs(paymentsTotal - total) < 0.01;

  /**
   * Só uma venda com alguma forma parcelada (crédito/boleto em mais de uma
   * vez) precisa de vencimento e intervalo — venda à vista nasce baixada na
   * hora e não tem o que agendar. É esta condição que mostra os dois campos
   * no Faturamento e que decide se eles vão no payload da RPC.
   */
  const hasInstallmentPayment = useMemo(
    () => payments.some((p) => INSTALLMENT_METHODS.includes(p.method) && p.installments > 1),
    [payments],
  );

  const canConfirm =
    headerValid &&
    cart.length > 0 &&
    payments.length > 0 &&
    paymentsMatch &&
    // O campo de data pode ser apagado; sem ele a RPC voltaria para os 30
    // dias padrão em silêncio, escondendo do operador o que foi gravado.
    (!hasInstallmentPayment || header.firstDueDate.trim() !== "") &&
    !submitting;

  async function confirmSale(options?: { emitirNota?: boolean }) {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    setFiscalOutcome(null);
    try {
      const input: CreateSaleInput = {
        branchId,
        contactId: header.clienteId,
        sellerId: header.vendedorId,
        address: header.endereco || undefined,
        deliveryAddress: header.enderecoEntrega || undefined,
        operationType: header.tipoOperacao || undefined,
        department: header.departamento || undefined,
        costCenter: header.centroCustos || undefined,
        issueDate: header.dataEmissao,
        exitDate: header.dataSaida || undefined,
        freightAmount: freightValue,
        discountAmount: discountValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
        })),
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, installments: p.installments })),
        // Omitidos quando não há parcelamento: a RPC mantém o padrão dela
        // (30 dias / 30 dias) para quem não manda esses campos — é o caso do
        // PDV e de qualquer venda à vista.
        firstDueDate: hasInstallmentPayment ? header.firstDueDate : undefined,
        intervalDays: hasInstallmentPayment ? header.intervalDays : undefined,
      };
      const sale = await createSale(input);
      setConfirmedSale(sale);
      // A venda já está gravada aqui — uma falha de emissão nunca desfaz nem
      // trava o que já aconteceu, mesmo critério do gancho de NFC-e do PDV.
      if (options?.emitirNota) {
        setFiscalOutcome(await emitInvoiceForSale(branchId, sale.id));
      }
    } catch (err) {
      setSubmitError(extractErrorMessage(err, cart));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(buildHeaderInicial(defaultSeller));
    setCart([]);
    setPayments([]);
    setFreight("");
    setDiscount("");
    setSubmitError(null);
    setConfirmedSale(null);
    setFiscalOutcome(null);
    setLastRemoved(null);
  }

  return {
    header,
    setField,
    selectContact,
    selectSeller,
    headerValid,
    cart,
    addProduct,
    updateLine,
    removeLine,
    lineTotal,
    payments,
    addPayment,
    updatePayment,
    removePayment,
    lastRemoved,
    undoRemove,
    freight,
    setFreight,
    discount,
    setDiscount,
    subtotal,
    freightValue,
    discountValue,
    total,
    paymentsTotal,
    paymentsMatch,
    hasInstallmentPayment,
    canConfirm,
    submitting,
    submitError,
    confirmedSale,
    fiscalOutcome,
    confirmSale,
    reset,
  };
}
