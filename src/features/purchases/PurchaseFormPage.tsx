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
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import FormField from "../../components/form/FormField";
import LookupModal from "../../components/form/LookupModal";
import { useOpenWindows } from "../../components/openWindows";
import { PRODUCT_PICKER_DRAG_PREFIX } from "../../components/product-picker/ProductPickerPanel";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import { useAuth } from "../auth/AuthContext";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { fetchContactsByKind } from "../../lib/repositories/contactLookups";
import { PurchasesIcon } from "../home/icons";
import { formatMoney, SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "../sales/sales";
import { usePurchaseDraft } from "./usePurchaseDraft";
import "../sales/SalePage.css";

// Mesma pegadinha documentada em SalePage.tsx/SaleOrderFormPage.tsx: um objeto
// literal novo a cada render cancelaria o drag em andamento quando
// `handleDragStart` causa re-render no meio do gesto.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

const PAYMENT_METHODS: SalePaymentMethod[] = ["dinheiro", "debito", "credito", "pix", "boleto", "outro"];

const CART_DROPZONE_ID = "purchase-cart-dropzone";

/** `useDroppable` só enxerga o `DndContext` de dentro dele — o drop-target precisa ser um filho. */
function CartDropzone({ children }: { children: (isOver: boolean) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CART_DROPZONE_ID });
  return (
    <div className="sale__card" ref={setNodeRef}>
      {children(isOver)}
    </div>
  );
}

/** Tela de criação de uma nova Compra: espelha `SaleOrderFormPage.tsx` — cabeçalho + itens, sem split de pagamento. */
export default function PurchaseFormPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId } = useAuth();
  const draft = usePurchaseDraft(currentBranchId);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const canCreate = hasPermission("compras", "create");

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
      id: "compras",
      label: "Compras",
      path: "/compras",
      icon: PurchasesIcon,
    });
  }, [openWindow]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (draft.confirmedPurchase) {
    return (
      <AppShell navItems={navItems} secondaryText="Compras">
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card sale__card--success">
              <p className="sale__success-title">Compra {draft.confirmedPurchase.code} salva!</p>
              <p className="sale__success-total">Total: {formatMoney(draft.confirmedPurchase.totalAmount)}</p>
              <div className="sale__success-actions">
                <button className="sale__continue" type="button" onClick={() => draft.reset()}>
                  Nova compra
                </button>
                <button className="sale__back" type="button" onClick={() => navigate("/compras")}>
                  Ver compras
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Compras">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card">
              <p className="sale__cart-title">Dados da compra</p>
              <div className="sale__who">
                <FormField
                  id="compra-fornecedor"
                  label="Fornecedor"
                  value={draft.header.fornecedorNome}
                  onChange={(v) => draft.setField("fornecedorNome", v)}
                  lookup
                  onLookup={() => setLookupOpen(true)}
                />
                <FormField
                  id="compra-documento"
                  label="Número documento"
                  value={draft.header.document}
                  onChange={(v) => draft.setField("document", v)}
                />
              </div>

              <div className="sale__who">
                <FormField
                  id="compra-emissao"
                  label="Data de emissão"
                  type="date"
                  value={draft.header.issueDate}
                  onChange={(v) => draft.setField("issueDate", v)}
                />
                <FormField
                  id="compra-entrada"
                  label="Data de entrada"
                  type="date"
                  value={draft.header.entryDate}
                  onChange={(v) => draft.setField("entryDate", v)}
                />
              </div>

              <div className="sale__who">
                <label className="form-field">
                  <span className="form-field__label">Forma de pagamento</span>
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

                {!draft.isPaidOnTheSpot && (
                  <label className="form-field">
                    <span className="form-field__label">Parcelas</span>
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={1}
                      step="1"
                      value={draft.header.installmentCount}
                      onChange={(e) => draft.setField("installmentCount", Number(e.target.value) || 1)}
                    />
                  </label>
                )}
              </div>

              {!draft.isPaidOnTheSpot && (
                <div className="sale__who">
                  <FormField
                    id="compra-vencimento"
                    label="Vencimento da 1ª parcela"
                    type="date"
                    value={draft.header.firstDueDate}
                    onChange={(v) => draft.setField("firstDueDate", v)}
                    hint="Sugerido em 30 dias — ajuste pelo prazo combinado com o fornecedor."
                  />
                  <label className="form-field">
                    <span className="form-field__label">Intervalo entre parcelas (dias)</span>
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={1}
                      step="1"
                      value={draft.header.intervalDays}
                      onChange={(e) => draft.setField("intervalDays", Number(e.target.value) || 1)}
                    />
                  </label>
                </div>
              )}

              <label className="sale__update-cost">
                <input
                  type="checkbox"
                  checked={draft.header.updateCostPrice}
                  onChange={(e) => draft.setField("updateCostPrice", e.target.checked)}
                />
                <span>Atualizar o preço de custo dos produtos comprados no cadastro</span>
              </label>
            </div>
          </div>

          <div className="sale__step-body sale__step-body--produtos">
            <div className="sale__products-panel">
              <ProductPickerPanel
                branchId={currentBranchId}
                onAddProduct={(p) => draft.addProduct(p)}
                hint="Clique ou arraste um produto para adicionar à compra."
              />
            </div>

            <div className="sale__panel">
              <CartDropzone>
                {(isCartOver) => (
                  <>
                    <p className="sale__cart-title">Itens da compra</p>

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
                            <span>Custo unitário</span>
                            <span className="sale__cart-line-total">Total</span>
                            <span />
                          </div>
                          {draft.cart.map((line) => (
                            <div className="sale__cart-line sale__cart-line--purchase" key={line.lineId}>
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
                                aria-label={`Custo unitário — ${line.product.description}`}
                                value={line.unitCost}
                                onChange={(e) =>
                                  draft.updateLine(line.lineId, { unitCost: Number(e.target.value) || 0 })
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
                      <div className="sale__totals-row sale__totals-row--total">
                        <span>Total</span>
                        <span>{formatMoney(draft.total)}</span>
                      </div>
                    </div>

                    {draft.submitError && <p className="sale__error">{draft.submitError}</p>}
                    {!canCreate && <p className="sale__error">Você não tem permissão para criar compras.</p>}

                    <div className="sale__confirm-actions">
                      <button
                        className="sale__continue"
                        type="button"
                        disabled={!draft.canConfirm || !canCreate}
                        onClick={() => draft.confirmPurchase()}
                      >
                        {draft.submitting ? "Salvando..." : "Salvar compra"}
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

      {lookupOpen && (
        <LookupModal<Contact>
          title="Selecionar fornecedor"
          placeholder="Buscar por nome ou documento..."
          onClose={() => setLookupOpen(false)}
          fetchItems={(query) => fetchContactsByKind("fornecedores", query)}
          getKey={(c) => c.id}
          renderItem={(c) => ({ primary: c.name, secondary: c.document })}
          onSelect={(c) => {
            draft.selectContact(c);
            setLookupOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}
