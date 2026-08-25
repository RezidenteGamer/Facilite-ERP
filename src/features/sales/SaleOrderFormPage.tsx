import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import SearchCombobox from "../../components/form/SearchCombobox";
import { useOpenWindows } from "../../components/openWindows";
import { PRODUCT_PICKER_DRAG_PREFIX } from "../../components/product-picker/ProductPickerPanel";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import { useAuth } from "../auth/AuthContext";
import type { Contact } from "../customers/contacts";
import QuickContactFormModal from "../customers/QuickContactFormModal";
import type { Product } from "../products/products";
import { fetchSaleContacts, fetchSaleSellers, type SaleSeller } from "../../lib/repositories/salesLookups";
import { SaleOrdersIcon } from "../home/icons";
import { formatMoney, SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "./sales";
import { useSaleOrderDraft } from "./useSaleOrderDraft";
import "./SalePage.css";

// Mesma pegadinha documentada em SalePage.tsx: um objeto literal novo a cada
// render cancelaria o drag em andamento quando `handleDragStart` causa
// re-render no meio do gesto.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

const PAYMENT_METHODS: SalePaymentMethod[] = ["dinheiro", "debito", "credito", "pix", "boleto", "outro"];

const CART_DROPZONE_ID = "sale-order-cart-dropzone";

/* Mesmo id de janela que a lista (`SaleOrdersPage.tsx`) — lista e formulário
   são duas sub-rotas do mesmo módulo no dock, ver `updateWindowPath`. */
const SALE_ORDER_WINDOW_ID = "pedidos-venda";



/** `useDroppable` só enxerga o `DndContext` de dentro dele — o drop-target precisa ser um filho. */
function CartDropzone({ children }: { children: (isOver: boolean) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CART_DROPZONE_ID });
  return (
    <div className="sale__card" ref={setNodeRef}>
      {children(isOver)}
    </div>
  );
}

/** Tela de criação de um novo Pedido de venda: espelha `SalePage.tsx`, mas em uma etapa só. */
export default function SaleOrderFormPage() {
  const navigate = useNavigate();
  const { openWindow, updateWindowPath } = useOpenWindows();
  const { hasPermission, currentBranchId, profile } = useAuth();
  const defaultSeller = useMemo(
    () => (profile ? { id: profile.id, name: profile.name, operatorCode: profile.operatorCode } : null),
    [profile],
  );
  const draft = useSaleOrderDraft(currentBranchId, defaultSeller, SALE_ORDER_WINDOW_ID);
  /** Nome digitado que originou o "Cadastrar novo" — `null` = modal fechado. */
  const [creatingContactName, setCreatingContactName] = useState<string | null>(null);
  const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const canCreate = hasPermission("pedidos-venda", "create");
  /* Sem permissão de criar contato o atalho some — oferecer um cadastro que a
     RLS vai recusar só produz erro. */
  const canCreateContact = hasPermission("clientes-fornecedores", "create");

  function handleDragStart(event: DragStartEvent) {
    const product = event.active.data.current?.product as Product | undefined;
    setDraggingProduct(product ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingProduct(null);
    const isProductDrag = String(event.active.id).startsWith(PRODUCT_PICKER_DRAG_PREFIX);
    const product = event.active.data.current?.product as Product | undefined;
    if (isProductDrag && product && event.over?.id === CART_DROPZONE_ID) {
      draft.addProduct(product);
    }
  }

  useEffect(() => {
    openWindow({
      id: SALE_ORDER_WINDOW_ID,
      label: "Pedidos de venda",
      path: "/pedidos-venda/novo",
      icon: SaleOrdersIcon,
    });
    // Garante que a janela aponte para o formulário mesmo quando a lista já
    // a registrou primeiro (`openWindow` não sobrescreve rota de janela
    // existente) — ver `updateWindowPath` em `openWindows.tsx`.
    updateWindowPath(SALE_ORDER_WINDOW_ID, "/pedidos-venda/novo");
  }, [openWindow, updateWindowPath]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (draft.confirmedOrder) {
    return (
      <AppShell navItems={navItems} secondaryText="Pedidos de venda">
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card sale__card--success">
              <p className="sale__success-title">Pedido {draft.confirmedOrder.code} salvo!</p>
              <p className="sale__success-total">Total: {formatMoney(draft.confirmedOrder.totalAmount)}</p>
              <div className="sale__success-actions">
                <button className="sale__continue" type="button" onClick={() => draft.reset()}>
                  Novo pedido
                </button>
                <button className="sale__back" type="button" onClick={() => navigate("/pedidos-venda")}>
                  Ver pedidos
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Pedidos de venda">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card">
              <p className="sale__cart-title">Quem é o cliente?</p>
              <div className="sale__who">
                <SearchCombobox<Contact>
                  id="pedido-cliente"
                  label="Cliente"
                  placeholder="Digite o nome ou o documento..."
                  value={draft.header.clienteNome}
                  onChange={(v) => {
                    draft.setField("clienteNome", v);
                    /* Digitar por cima de quem já estava escolhido desfaz a
                       escolha — ver a nota do ClienteStep de Realizar Venda. */
                    if (draft.header.clienteId) draft.setField("clienteId", "");
                  }}
                  fetchItems={fetchSaleContacts}
                  getKey={(c) => c.id}
                  renderItem={(c) => ({ primary: c.name, secondary: c.document })}
                  onSelect={(c) => draft.selectContact(c)}
                  onCreateNew={canCreateContact ? (query) => setCreatingContactName(query) : undefined}
                  createNewLabel="Cadastrar novo cliente"
                />
                {/* Vendedor é usuário do sistema (`profiles`), não cadastro de
                    negócio: sem atalho de criar. */}
                <SearchCombobox<SaleSeller>
                  id="pedido-vendedor"
                  label="Vendedor"
                  placeholder="Digite o nome..."
                  value={draft.header.vendedorNome}
                  onChange={(v) => {
                    draft.setField("vendedorNome", v);
                    if (draft.header.vendedorId) draft.setField("vendedorId", "");
                  }}
                  fetchItems={fetchSaleSellers}
                  getKey={(s) => s.id}
                  renderItem={(s) => ({ primary: s.name, secondary: s.operatorCode })}
                  onSelect={(s) => draft.selectSeller(s)}
                />
              </div>

              <div className="sale__who">
                <label className="form-field">
                  <span className="form-field__label">Forma de pagamento pretendida</span>
                  <select
                    className="sale__payment-select"
                    value={draft.header.paymentMethod}
                    onChange={(e) => draft.setField("paymentMethod", e.target.value as SalePaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {SALE_PAYMENT_METHOD_LABEL[method]}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.header.paymentMethod === "credito" && (
                  <label className="form-field">
                    <span className="form-field__label">Parcelas</span>
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={1}
                      step="1"
                      value={draft.header.installments}
                      onChange={(e) => draft.setField("installments", Number(e.target.value) || 1)}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="sale__step-body sale__step-body--produtos">
            <div className="sale__products-panel">
              <ProductPickerPanel
                branchId={currentBranchId}
                onAddProduct={(p) => draft.addProduct(p)}
                hint="Clique ou arraste um produto para adicionar ao pedido."
              />
            </div>

            <div className="sale__panel">
              <CartDropzone>
                {(isCartOver) => (
                  <>
                    <p className="sale__cart-title">Produtos do pedido</p>

                    <div className={`sale__cart-lines${isCartOver ? " sale__cart-lines--drop-active" : ""}`}>
                      {draft.cart.length === 0 ? (
                        <p className="sale__cart-empty">
                          Nenhum item adicionado ainda — comece buscando um produto ao lado.
                        </p>
                      ) : (
                        <>
                          <div className="sale__cart-line sale__cart-line--head" aria-hidden="true">
                            <span>Produto</span>
                            <span>Qtd.</span>
                            <span>Preço</span>
                            <span>Desconto</span>
                            <span className="sale__cart-line-total">Total</span>
                            <span />
                          </div>
                          {draft.cart.map((line) => (
                            <div className="sale__cart-line" key={line.lineId}>
                              <div className="sale__cart-line-info">
                                <span className="sale__cart-line-name">{line.product.description}</span>
                                <span className="sale__cart-line-code">{line.product.code}</span>
                              </div>
                              <input
                                className="sale__cart-line-input"
                                type="number"
                                min={0.001}
                                step="0.001"
                                aria-label={`Quantidade — ${line.product.description}`}
                                value={line.quantity}
                                onChange={(e) =>
                                  draft.updateLine(line.lineId, { quantity: Number(e.target.value) || 0 })
                                }
                              />
                              <input
                                className="sale__cart-line-input"
                                type="number"
                                min={0}
                                step="0.01"
                                aria-label={`Preço unitário — ${line.product.description}`}
                                value={line.unitPrice}
                                onChange={(e) =>
                                  draft.updateLine(line.lineId, { unitPrice: Number(e.target.value) || 0 })
                                }
                              />
                              <input
                                className="sale__cart-line-input"
                                type="number"
                                min={0}
                                step="0.01"
                                aria-label={`Desconto — ${line.product.description}`}
                                value={line.discountAmount}
                                onChange={(e) =>
                                  draft.updateLine(line.lineId, { discountAmount: Number(e.target.value) || 0 })
                                }
                              />
                              <span className="sale__cart-line-total">{formatMoney(draft.lineTotal(line))}</span>
                              <button
                                className="sale__cart-line-remove"
                                type="button"
                                aria-label={`Remover ${line.product.description}`}
                                onClick={() => draft.removeLine(line.lineId)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {draft.lastRemoved && (
                      <div className="sale__undo" role="status">
                        <span>{`"${draft.lastRemoved.line.product.description}" removido.`}</span>
                        <button className="sale__undo-btn" type="button" onClick={draft.undoRemove}>
                          Desfazer
                        </button>
                      </div>
                    )}

                    <div className="sale__totals">
                      <label className="sale__totals-input-row">
                        <span>Frete</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={draft.freight}
                          onChange={(e) => draft.setFreight(e.target.value)}
                        />
                      </label>
                      <label className="sale__totals-input-row">
                        <span>Desconto</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          value={draft.discount}
                          onChange={(e) => draft.setDiscount(e.target.value)}
                        />
                      </label>
                      <div className="sale__totals-row">
                        <span>Subtotal</span>
                        <span>{formatMoney(draft.subtotal)}</span>
                      </div>
                      <div className="sale__totals-row sale__totals-row--total">
                        <span>Total</span>
                        <span>{formatMoney(draft.total)}</span>
                      </div>
                    </div>

                    {draft.submitError && <p className="sale__error">{draft.submitError}</p>}
                    {!canCreate && <p className="sale__error">Você não tem permissão para criar pedidos de venda.</p>}

                    <div className="sale__confirm-actions">
                      <button
                        className="sale__continue"
                        type="button"
                        disabled={!draft.canConfirm || !canCreate}
                        onClick={() => draft.confirmOrder()}
                      >
                        {draft.submitting ? "Salvando..." : "Salvar pedido"}
                      </button>
                    </div>
                  </>
                )}
              </CartDropzone>
            </div>
          </div>
        </div>

        <DragOverlay>
          {draggingProduct ? (
            <div className="product-picker__drag-overlay">{draggingProduct.description}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {creatingContactName !== null && (
        <QuickContactFormModal
          kind="clientes"
          initialName={creatingContactName}
          onCancel={() => setCreatingContactName(null)}
          onCreated={(contact) => {
            draft.selectContact(contact);
            setCreatingContactName(null);
          }}
        />
      )}
    </AppShell>
  );
}
