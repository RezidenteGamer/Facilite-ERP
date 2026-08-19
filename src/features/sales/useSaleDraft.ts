import { useEffect, useMemo, useState } from "react";
import { formatContactAddress, type Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { createSale, type CreateSaleInput } from "../../lib/repositories/salesRepository";
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
};

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
function extractErrorMessage(err: unknown, cart: CartLine[]): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";

  const stockMatch = raw.match(STOCK_ERROR);
  if (stockMatch) {
    const product = cart.find((line) => line.product.id === stockMatch[1])?.product;
    return product
      ? `Estoque insuficiente para "${product.description}" — reduza a quantidade ou remova o item.`
      : "Estoque insuficiente para um dos produtos da venda.";
  }

  const mismatchMatch = raw.match(PAYMENTS_MISMATCH_ERROR);
  if (mismatchMatch) {
    const paid = Number(mismatchMatch[1].replace(",", "."));
    const total = Number(mismatchMatch[2].replace(",", "."));
    return `A soma dos pagamentos (${formatMoney(paid)}) não bate com o total da venda (${formatMoney(total)}).`;
  }

  // Mensagens conhecidas da RPC (permissão, filial, item/pagamento obrigatório,
  // produto não encontrado/fora da filial) já vêm prontas em português — passa direto.
  const KNOWN_MESSAGES = [
    "Sem permissão para criar vendas.",
    "Sem acesso a esta filial.",
    "A venda precisa de ao menos um item.",
    "A venda precisa de ao menos uma forma de pagamento.",
    "Produto não encontrado.",
    "Produto não pertence à filial da venda.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";
}

/**
 * Estado do rascunho de uma venda em andamento: cabeçalho + carrinho + pagamentos.
 * `defaultSeller` (o operador logado) pré-preenche o Vendedor — ver `buildHeaderInicial`.
 */
export function useSaleDraft(branchId: string | null, defaultSeller?: SaleSeller | null) {
  const [header, setHeader] = useState<SaleHeaderForm>(() => buildHeaderInicial(defaultSeller));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [freight, setFreight] = useState("");
  const [discount, setDiscount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedSale, setConfirmedSale] = useState<Sale | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  // Some sozinho depois de alguns segundos — "Desfazer" não deveria ficar
  // preso na tela pro resto da venda. Cada remoção nova reinicia a contagem.
  useEffect(() => {
    if (!lastRemoved) return;
    const timer = window.setTimeout(() => setLastRemoved(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [lastRemoved]);

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

  function updateLine(lineId: string, patch: Partial<Pick<CartLine, "quantity" | "unitPrice" | "discountAmount">>) {
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
  const freightValue = Math.max(0, Number(freight.replace(",", ".")) || 0);
  const discountValue = Math.max(0, Number(discount.replace(",", ".")) || 0);
  const total = Math.max(0, subtotal + freightValue - discountValue);
  const paymentsTotal = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments]);
  const paymentsMatch = cart.length > 0 && Math.abs(paymentsTotal - total) < 0.01;

  const canConfirm = headerValid && cart.length > 0 && payments.length > 0 && paymentsMatch && !submitting;

  async function confirmSale() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
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
      };
      const sale = await createSale(input);
      setConfirmedSale(sale);
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
    canConfirm,
    submitting,
    submitError,
    confirmedSale,
    confirmSale,
    reset,
  };
}
