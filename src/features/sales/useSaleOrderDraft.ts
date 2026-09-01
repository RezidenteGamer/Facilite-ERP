import { useEffect, useMemo, useState } from "react";
import { useOpenWindows } from "../../components/openWindows";
import { parseAmount } from "../../lib/amount";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { fetchProductsByIds } from "../../lib/repositories/productsRepository";
import {
  createSaleOrder,
  fetchSaleOrderWithItems,
  updateSaleOrder,
  type CreateSaleOrderInput,
} from "../../lib/repositories/saleOrdersRepository";
import type { SaleSeller } from "../../lib/repositories/salesLookups";
import type { SaleOrder } from "./saleOrders";
import type { SalePaymentMethod } from "./sales";

export type SaleOrderHeaderForm = {
  clienteId: string;
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  paymentMethod: SalePaymentMethod;
  installments: number;
  issueDate: string;
};

/** Vendedor nasce preenchido com quem está logado — mesmo raciocínio de `useSaleDraft`. */
function buildHeaderInicial(defaultSeller?: SaleSeller | null): SaleOrderHeaderForm {
  return {
    clienteId: "",
    clienteNome: "",
    vendedorId: defaultSeller?.id ?? "",
    vendedorNome: defaultSeller?.name ?? "",
    paymentMethod: "dinheiro",
    installments: 1,
    issueDate: new Date().toISOString().slice(0, 10),
  };
}

export type SaleOrderCartLine = {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

function lineTotal(line: SaleOrderCartLine) {
  return Math.max(0, line.quantity * line.unitPrice - line.discountAmount);
}

type RemovedEntry = { line: SaleOrderCartLine; index: number };

const UNDO_TIMEOUT_MS = 6000;

/**
 * Pedido não valida estoque nem soma de pagamentos (só reserva no papel — ver
 * decisão em AGENTS.md), então as únicas mensagens conhecidas da RPC são as
 * de permissão/filial/item obrigatório/produto. Mesmo padrão de
 * `extractErrorMessage` de `useSaleDraft.ts` — não reescrever mensagens que a
 * RPC já manda prontas.
 */
function extractErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return "Não foi possível salvar o pedido. Tente novamente — se o problema continuar, acione o suporte.";

  // `assert_discount_within_cap` (tarefa C3, 29/08/2026) — já vem pronta em
  // português, com os valores formatados; só repassamos.
  if (/^Desconto de [\d.,]+% acima do limite do seu perfil \([\d.,]+%\)\.$/.test(raw)) return raw;

  const KNOWN_MESSAGES = [
    "Sem permissão para criar pedidos de venda.",
    "Sem permissão para editar pedidos de venda.",
    "Sem acesso a esta filial.",
    "O pedido precisa de ao menos um item.",
    "Produto não encontrado.",
    "Produto não pertence à filial do pedido.",
    "Pedido não encontrado.",
    "Só é possível editar pedido em aberto.",
    "Quantidade inválida em um dos itens.",
    "Desconto do item maior que o valor do item.",
  ];
  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return "Não foi possível salvar o pedido. Tente novamente — se o problema continuar, acione o suporte.";
}

/**
 * Slot do rascunho dentro do estado da janela — ver `openWindows.tsx`.
 *
 * O modo edição usa um slot **por pedido** (`...:<id>`) em vez do slot de
 * "novo pedido": lista e formulário compartilham um id de janela só
 * (`"pedidos-venda"`), então, com um slot único, montar um pedido novo,
 * ir editar o pedido X e voltar carregaria os dados de um no outro. O
 * `windowId` continua o mesmo de propósito — é ele que `closeWindow` usa
 * para jogar fora tudo o que a janela guardava.
 */
const DRAFT_SLOT = "sale-order-draft";
function draftSlotFor(editingOrderId?: string | null) {
  return editingOrderId ? `${DRAFT_SLOT}:${editingOrderId}` : DRAFT_SLOT;
}

/**
 * O que sobrevive a uma troca de janela: só o que o operador digitou — mesmo
 * critério de `PersistedSaleDraft` em `useSaleDraft.ts`.
 */
type PersistedSaleOrderDraft = {
  header: SaleOrderHeaderForm;
  cart: SaleOrderCartLine[];
  freight: string;
  discount: string;
};

/**
 * Estado do rascunho de um pedido em andamento: cabeçalho + carrinho. Sem
 * split de pagamento — ver AGENTS.md. `windowId` é o mesmo id passado a
 * `openWindow`: com ele o rascunho sobrevive a ir em outra janela e voltar —
 * ver a decisão "estado por janela no `OpenWindowsProvider`" em AGENTS.md.
 *
 * Com `editingOrderId` o hook entra em **modo edição**: em vez de nascer em
 * branco, carrega o pedido com os itens e chama `update_sale_order` no
 * submit. O rascunho de edição mora num slot próprio (ver `draftSlotFor`),
 * para nunca se misturar com o de "novo pedido".
 */
export function useSaleOrderDraft(
  branchId: string | null,
  defaultSeller?: SaleSeller | null,
  windowId?: string | null,
  editingOrderId?: string | null,
) {
  const { getWindowState, setWindowState, clearWindowState } = useOpenWindows();
  const draftSlot = draftSlotFor(editingOrderId);
  // Lido uma única vez, na montagem — depois disso a fonte da verdade é o
  // `useState` daqui.
  const [restored] = useState(() =>
    windowId ? getWindowState<PersistedSaleOrderDraft>(windowId, draftSlot) : undefined,
  );

  const [header, setHeader] = useState<SaleOrderHeaderForm>(
    () => restored?.header ?? buildHeaderInicial(defaultSeller),
  );
  const [cart, setCart] = useState<SaleOrderCartLine[]>(() => restored?.cart ?? []);
  const [freight, setFreight] = useState(() => restored?.freight ?? "");
  const [discount, setDiscount] = useState(() => restored?.discount ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<SaleOrder | null>(null);
  const [lastRemoved, setLastRemoved] = useState<RemovedEntry | null>(null);

  /* Só existem em modo edição: o pedido que está sendo editado (de onde saem
     código e situação, que o formulário mostra e usa para se barrar) e o
     estado da busca dele. */
  const [editingOrder, setEditingOrder] = useState<SaleOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(editingOrderId));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = window.setTimeout(() => setLastRemoved(null), UNDO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [lastRemoved]);

  /* Modo edição: busca o pedido com os itens e reidrata o formulário.
     `fetchSaleOrderWithItems` (da rodada de pré-visualização) devolve só o
     `product_id` de cada item, mas a linha do carrinho guarda o `Product`
     inteiro (unidade, preço, código) — daí a segunda busca.
     **O pedido é buscado mesmo quando há rascunho salvo**, porque código e
     situação vêm dele; o que o rascunho salvo impede é sobrescrever o que o
     operador já tinha mexido antes de trocar de janela. */
  useEffect(() => {
    if (!editingOrderId || !branchId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      const detail = await fetchSaleOrderWithItems(editingOrderId);
      const products = await fetchProductsByIds(branchId, detail.items.map((item) => item.productId));
      const byId = new Map(products.map((product) => [product.id, product]));
      const missing = detail.items.find((item) => !byId.has(item.productId));
      if (missing) {
        throw new Error(
          `O produto "${missing.productDescription || missing.productCode}" não está mais disponível nesta filial — não dá para editar este pedido.`,
        );
      }
      return {
        detail,
        cart: detail.items.map<SaleOrderCartLine>((item) => ({
          lineId: crypto.randomUUID(),
          product: byId.get(item.productId) as Product,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
        })),
      };
    })()
      .then(({ detail, cart: loadedCart }) => {
        if (cancelled) return;
        setEditingOrder(detail);
        if (!restored) {
          setHeader({
            clienteId: detail.contactId,
            clienteNome: detail.contactName,
            vendedorId: detail.sellerId,
            vendedorNome: detail.sellerName,
            paymentMethod: detail.paymentMethod,
            installments: detail.installments,
            issueDate: detail.issueDate,
          });
          setCart(loadedCart);
          setFreight(detail.freightAmount ? String(detail.freightAmount) : "");
          setDiscount(detail.discountAmount ? String(detail.discountAmount) : "");
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Não foi possível carregar o pedido.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingOrderId, branchId, restored]);

  /* Espelha o rascunho no estado da janela a cada mudança — mesmo raciocínio
     do efeito equivalente em `useSaleDraft.ts`. O pedido confirmado é o outro
     fim de vida: `confirmedOrder` não zera o rascunho (a tela de sucesso
     ainda mostra o que foi salvo), então, se este efeito continuasse
     gravando, abrir "Pedidos de venda" de novo ressuscitaria o pedido que
     acabou de ser salvo — aqui o rascunho acaba, limpa em vez de gravar. */
  useEffect(() => {
    if (!windowId) return;
    /* Em modo edição, gravar antes de o pedido chegar salvaria um formulário
       vazio por cima do slot — e uma troca de janela nessa fresta faria a
       volta restaurar o vazio em vez de recarregar o pedido. */
    if (loading) return;
    if (confirmedOrder) {
      /* Fim de vida do rascunho. Em modo edição limpa **só o slot deste
         pedido**: `clearWindowState` é por janela inteira e levaria junto o
         rascunho de "novo pedido", que não tem nada a ver com esta edição. */
      if (editingOrderId) setWindowState<PersistedSaleOrderDraft | undefined>(windowId, draftSlot, undefined);
      else clearWindowState(windowId);
      return;
    }
    setWindowState<PersistedSaleOrderDraft>(windowId, draftSlot, { header, cart, freight, discount });
  }, [
    windowId,
    draftSlot,
    editingOrderId,
    loading,
    confirmedOrder,
    header,
    cart,
    freight,
    discount,
    setWindowState,
    clearWindowState,
  ]);

  useEffect(() => {
    if (!defaultSeller) return;
    setHeader((current) =>
      current.vendedorId ? current : { ...current, vendedorId: defaultSeller.id, vendedorNome: defaultSeller.name },
    );
  }, [defaultSeller]);

  function setField<K extends keyof SaleOrderHeaderForm>(field: K, value: SaleOrderHeaderForm[K]) {
    setHeader((current) => ({ ...current, [field]: value }));
  }

  function selectContact(contact: Contact) {
    setHeader((current) => ({ ...current, clienteId: contact.id, clienteNome: contact.name }));
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
        { lineId: crypto.randomUUID(), product, quantity: 1, unitPrice: product.salePrice, discountAmount: 0 },
      ];
    });
  }

  // `unitPrice` não entra no patch — a RPC lê o preço sempre de
  // `products.sale_price` (tarefa C3, 29/08/2026).
  function updateLine(lineId: string, patch: Partial<Pick<SaleOrderCartLine, "quantity" | "discountAmount">>) {
    setCart((current) => current.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  }

  function removeLine(lineId: string) {
    const index = cart.findIndex((line) => line.lineId === lineId);
    if (index === -1) return;
    setLastRemoved({ line: cart[index], index });
    setCart((current) => current.filter((line) => line.lineId !== lineId));
  }

  function undoRemove() {
    if (!lastRemoved) return;
    const { line, index } = lastRemoved;
    setCart((current) => {
      const next = [...current];
      next.splice(Math.min(index, next.length), 0, line);
      return next;
    });
    setLastRemoved(null);
  }

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + lineTotal(line), 0), [cart]);
  const freightValue = Math.max(0, parseAmount(freight) ?? 0);
  const discountValue = Math.max(0, parseAmount(discount) ?? 0);
  const total = Math.max(0, subtotal + freightValue - discountValue);

  /* Em modo edição, o pedido tem que ter carregado e continuar `aberto` — a
     mesma barreira que `update_sale_order` impõe no banco. */
  const editable = !editingOrderId || (!loading && !loadError && editingOrder?.status === "aberto");
  const canConfirm = headerValid && cart.length > 0 && !submitting && editable;

  async function confirmOrder() {
    if (!branchId) {
      setSubmitError("Nenhuma filial selecionada.");
      return;
    }
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreateSaleOrderInput = {
        branchId,
        contactId: header.clienteId,
        sellerId: header.vendedorId,
        paymentMethod: header.paymentMethod,
        installments: header.installments,
        issueDate: header.issueDate,
        freightAmount: freightValue,
        discountAmount: discountValue,
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
        })),
      };
      const order = editingOrderId ? await updateSaleOrder(editingOrderId, input) : await createSaleOrder(input);
      setConfirmedOrder(order);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setHeader(buildHeaderInicial(defaultSeller));
    setCart([]);
    setFreight("");
    setDiscount("");
    setSubmitError(null);
    setConfirmedOrder(null);
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
    canConfirm,
    submitting,
    submitError,
    confirmedOrder,
    confirmOrder,
    reset,
    /* Modo edição — `isEditing` é falso em "novo pedido", e aí os três
       seguintes não têm significado nenhum. */
    isEditing: Boolean(editingOrderId),
    editingOrder,
    editable,
    loading,
    loadError,
  };
}
