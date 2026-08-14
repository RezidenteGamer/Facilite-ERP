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
import ConfirmDialog from "../../components/ConfirmDialog";
import FormField from "../../components/form/FormField";
import LookupModal from "../../components/form/LookupModal";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import ProductPickerPanel, { PRODUCT_PICKER_DRAG_PREFIX } from "../../components/product-picker/ProductPickerPanel";
import { useAuth } from "../auth/AuthContext";
import type { Contact } from "../customers/contacts";
import { fetchSaleContacts, fetchSaleSellers, type SaleSeller } from "../../lib/repositories/salesLookups";
import type { Product } from "../products/products";
import { SaleHandIcon } from "../home/icons";
import { formatMoney, SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "./sales";
import { useSaleDraft } from "./useSaleDraft";
import "./SalePage.css";

type LookupKind = "cliente" | "vendedor" | null;

const CART_DROPZONE_ID = "sale-cart-dropzone";
// Fora do componente: um objeto literal novo a cada render faria o `useSensor`
// devolver uma sensor list nova a cada render (ele depende da identidade do
// objeto `options`), e o `DndContext` reinicia os sensores sempre que essa
// lista muda — inclusive no meio de um drag, quando `handleDragStart` já
// causa um re-render por si só (`setDraggingProduct`). Isso cancelava o
// drag assim que ele começava.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };
const PAYMENT_METHODS: SalePaymentMethod[] = ["dinheiro", "debito", "credito", "pix", "boleto", "outro"];

/**
 * `useDroppable` só enxerga o `DndContext` quando chamado por um componente
 * renderizado DENTRO dele — chamar no mesmo componente que declara o
 * `<DndContext>` não funciona (o hook roda "antes" do provider existir do
 * ponto de vista da árvore de componentes). Por isso o card da venda vira
 * este componente filho.
 */
function CartDropzone({ children }: { children: (isOver: boolean) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CART_DROPZONE_ID });
  return (
    <div className="sale__card" ref={setNodeRef}>
      {children(isOver)}
    </div>
  );
}

/** Módulo "Realizar uma venda": produtos à esquerda (clique ou arraste), venda à direita. */
export default function SalePage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId } = useAuth();
  const draft = useSaleDraft(currentBranchId);
  const [lookup, setLookup] = useState<LookupKind>(null);
  const [confirming, setConfirming] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const canCreate = hasPermission("realizar-venda", "create");

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
      id: "realizar-venda",
      label: "Realizar uma venda",
      path: "/realizar-venda",
      icon: SaleHandIcon,
    });
  }, [openWindow]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (draft.confirmedSale) {
    return (
      <AppShell navItems={navItems} secondaryText="Realizar venda">
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card sale__card--success">
              <p className="sale__success-title">Venda {draft.confirmedSale.code} confirmada!</p>
              <p className="sale__success-total">Total: {formatMoney(draft.confirmedSale.totalAmount)}</p>
              <div className="sale__success-actions">
                <button className="sale__continue" type="button" onClick={() => draft.reset()}>
                  Nova venda
                </button>
                <button className="sale__back" type="button" onClick={() => navigate("/inicio")}>
                  Início
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Realizar venda">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="sale sale--workspace">
          <div className="sale__products-panel">
            <ProductPickerPanel branchId={currentBranchId} onAddProduct={(p) => draft.addProduct(p)} />
          </div>

          <div className="sale__panel">
            <CartDropzone>
              {(isCartOver) => (
                <>
              <p className="sale__cart-title">Venda</p>

              <div className="sale__who">
                <FormField
                  id="venda-cliente"
                  label="Cliente"
                  value={draft.header.clienteNome}
                  onChange={(v) => draft.setField("clienteNome", v)}
                  lookup
                  onLookup={() => setLookup("cliente")}
                />
                <FormField
                  id="venda-vendedor"
                  label="Vendedor"
                  value={draft.header.vendedorNome}
                  onChange={(v) => draft.setField("vendedorNome", v)}
                  lookup
                  onLookup={() => setLookup("vendedor")}
                />
              </div>

            <div className={`sale__cart-lines${isCartOver ? " sale__cart-lines--drop-active" : ""}`}>
              {draft.cart.length === 0 ? (
                <p className="sale__cart-empty">Nenhum item adicionado ainda — comece buscando um produto acima.</p>
              ) : (
                draft.cart.map((line) => (
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
                      value={line.quantity}
                      onChange={(e) => draft.updateLine(line.lineId, { quantity: Number(e.target.value) || 0 })}
                    />
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => draft.updateLine(line.lineId, { unitPrice: Number(e.target.value) || 0 })}
                    />
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.discountAmount}
                      onChange={(e) =>
                        draft.updateLine(line.lineId, { discountAmount: Number(e.target.value) || 0 })
                      }
                    />
                    <span className="sale__cart-line-total">{formatMoney(draft.lineTotal(line))}</span>
                    <button
                      className="sale__cart-line-remove"
                      type="button"
                      aria-label="Remover item"
                      onClick={() => draft.removeLine(line.lineId)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="sale__payments">
              <div className="sale__payments-header">
                <strong>Formas de pagamento</strong>
                <button className="sale__payments-add" type="button" onClick={() => draft.addPayment()}>
                  + Adicionar pagamento
                </button>
              </div>

              {draft.payments.length === 0 ? (
                <p className="sale__cart-empty">Adicione ao menos uma forma de pagamento.</p>
              ) : (
                draft.payments.map((payment) => (
                  <div className="sale__payment-line" key={payment.lineId}>
                    <select
                      className="sale__payment-select"
                      value={payment.method}
                      onChange={(e) =>
                        draft.updatePayment(payment.lineId, { method: e.target.value as SalePaymentMethod })
                      }
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {SALE_PAYMENT_METHOD_LABEL[method]}
                        </option>
                      ))}
                    </select>
                    <input
                      className="sale__cart-line-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={payment.amount}
                      onChange={(e) => draft.updatePayment(payment.lineId, { amount: Number(e.target.value) || 0 })}
                    />
                    {payment.method === "credito" && (
                      <input
                        className="sale__cart-line-input sale__cart-line-input--narrow"
                        type="number"
                        min={1}
                        step="1"
                        value={payment.installments}
                        onChange={(e) =>
                          draft.updatePayment(payment.lineId, { installments: Number(e.target.value) || 1 })
                        }
                      />
                    )}
                    <button
                      className="sale__cart-line-remove"
                      type="button"
                      aria-label="Remover pagamento"
                      onClick={() => draft.removePayment(payment.lineId)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

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
              <div className={`sale__totals-row${draft.paymentsMatch ? " sale__totals-row--ok" : " sale__totals-row--warn"}`}>
                <span>Pagamentos</span>
                <span>{formatMoney(draft.paymentsTotal)}</span>
              </div>
            </div>

            <button
              className="sale__details-toggle"
              type="button"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? "Ocultar detalhes da operação" : "Detalhes da operação (opcional)"}
              <span className={`sale__details-chevron${detailsOpen ? " sale__details-chevron--open" : ""}`} aria-hidden="true">
                ▾
              </span>
            </button>

            {detailsOpen && (
              <div className="sale__details-grid">
                <FormField
                  id="venda-tipo-operacao"
                  label="Tipo de operação"
                  value={draft.header.tipoOperacao}
                  onChange={(v) => draft.setField("tipoOperacao", v)}
                />
                <FormField
                  id="venda-departamento"
                  label="Departamento"
                  value={draft.header.departamento}
                  onChange={(v) => draft.setField("departamento", v)}
                />
                <FormField
                  id="venda-endereco"
                  label="Endereço"
                  value={draft.header.endereco}
                  onChange={(v) => draft.setField("endereco", v)}
                />
                <FormField
                  id="venda-centro-custos"
                  label="Centro de custos"
                  value={draft.header.centroCustos}
                  onChange={(v) => draft.setField("centroCustos", v)}
                />
                <FormField
                  id="venda-endereco-entrega"
                  label="Endereço de entrega"
                  value={draft.header.enderecoEntrega}
                  onChange={(v) => draft.setField("enderecoEntrega", v)}
                />
                <FormField
                  id="venda-data-emissao"
                  label="Data de emissão"
                  type="date"
                  value={draft.header.dataEmissao}
                  onChange={(v) => draft.setField("dataEmissao", v)}
                />
                <div />
                <FormField
                  id="venda-data-saida"
                  label="Data de saída"
                  type="date"
                  value={draft.header.dataSaida}
                  onChange={(v) => draft.setField("dataSaida", v)}
                />
              </div>
            )}

            {!draft.headerValid && (draft.cart.length > 0 || draft.payments.length > 0) && (
              <p className="sale__error">Selecione o cliente e o vendedor para confirmar a venda.</p>
            )}
            {draft.submitError && <p className="sale__error">{draft.submitError}</p>}
            {!canCreate && <p className="sale__error">Você não tem permissão para confirmar vendas.</p>}

            <div className="sale__footer">
              <button
                className="sale__continue"
                type="button"
                disabled={!draft.canConfirm || !canCreate}
                onClick={() => setConfirming(true)}
              >
                {draft.submitting ? "Confirmando..." : `Confirmar venda — ${formatMoney(draft.total)}`}
              </button>
            </div>
                </>
              )}
            </CartDropzone>
          </div>
        </div>

        <DragOverlay>
          {draggingProduct ? (
            <div className="product-picker__drag-overlay">{draggingProduct.description}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {lookup === "cliente" && (
        <LookupModal<Contact>
          title="Selecionar cliente"
          placeholder="Buscar por nome ou documento..."
          onClose={() => setLookup(null)}
          fetchItems={fetchSaleContacts}
          getKey={(c) => c.id}
          renderItem={(c) => ({ primary: c.name, secondary: c.document })}
          onSelect={(c) => {
            draft.selectContact(c);
            setLookup(null);
          }}
        />
      )}

      {lookup === "vendedor" && (
        <LookupModal<SaleSeller>
          title="Selecionar vendedor"
          placeholder="Buscar por nome..."
          onClose={() => setLookup(null)}
          fetchItems={fetchSaleSellers}
          getKey={(s) => s.id}
          renderItem={(s) => ({ primary: s.name, secondary: s.operatorCode })}
          onSelect={(s) => {
            draft.selectSeller(s);
            setLookup(null);
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Confirmar venda?"
          message={`Total ${formatMoney(draft.total)} — esta ação grava a venda e baixa o estoque dos produtos.`}
          confirmLabel="Confirmar"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            draft.confirmSale();
          }}
        />
      )}
    </AppShell>
  );
}
