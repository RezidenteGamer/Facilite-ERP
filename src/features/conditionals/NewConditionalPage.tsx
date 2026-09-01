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
import SearchCombobox from "../../components/form/SearchCombobox";
import { useOpenWindows } from "../../components/openWindows";
import { PRODUCT_PICKER_DRAG_PREFIX } from "../../components/product-picker/ProductPickerPanel";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import { useAuth } from "../auth/AuthContext";
import QuickContactFormModal from "../customers/QuickContactFormModal";
import type { Contact } from "../customers/contacts";
import type { Product } from "../products/products";
import { fetchContactsByKind } from "../../lib/repositories/contactLookups";
import { RefreshIcon } from "../home/icons";
import { formatConditionalTotal } from "./conditionals";
import { useConditionalDraft } from "./useConditionalDraft";
import "../sales/SalePage.css";

// Mesma pegadinha documentada em SalePage.tsx/SaleOrderFormPage.tsx: um
// objeto literal novo a cada render cancelaria o drag em andamento.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

const CART_DROPZONE_ID = "conditional-cart-dropzone";

/* Mesmo id de janela que a lista (`ConditionalsPage.tsx`) — ver `updateWindowPath`. */
const CONDITIONAL_WINDOW_ID = "condicionais";

/** `useDroppable` só enxerga o `DndContext` de dentro dele — o drop-target precisa ser um filho. */
function CartDropzone({ children }: { children: (isOver: boolean) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CART_DROPZONE_ID });
  return (
    <div className="sale__card" ref={setNodeRef}>
      {children(isOver)}
    </div>
  );
}

/**
 * Tela de criação de uma nova condicional: cliente + prazo de devolução +
 * itens. Cabeçalho+itens feito à mão, como Realizar Venda/Pedidos de venda —
 * não é um CRUD simples do motor genérico. Diferente de Pedidos de venda, o
 * estoque baixa **na hora** (a peça sai fisicamente da loja) — a RPC
 * `create_conditional` faz isso na mesma transação, não há campo de forma de
 * pagamento aqui porque nada foi vendido ainda.
 */
export default function NewConditionalPage() {
  const navigate = useNavigate();
  const { openWindow, updateWindowPath } = useOpenWindows();
  const { hasPermission, currentBranchId } = useAuth();
  const draft = useConditionalDraft(currentBranchId, CONDITIONAL_WINDOW_ID);
  /** Nome digitado que originou o "Cadastrar novo" - `null` = modal fechado. */
  const [creatingContactName, setCreatingContactName] = useState<string | null>(null);
  const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const canCreate = hasPermission("condicionais", "create");
  /* Sem permissao de criar contato o atalho some - oferecer um cadastro que a
     RLS vai recusar so produz erro. */
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
      id: CONDITIONAL_WINDOW_ID,
      label: "Condicionais",
      path: "/condicionais/nova",
      icon: RefreshIcon,
    });
    // Garante que a janela aponte para o formulário mesmo quando a lista já
    // a registrou primeiro — ver `updateWindowPath` em `openWindows.tsx`.
    updateWindowPath(CONDITIONAL_WINDOW_ID, "/condicionais/nova");
  }, [openWindow, updateWindowPath]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (draft.confirmed) {
    return (
      <AppShell navItems={navItems} secondaryText="Condicionais">
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card sale__card--success">
              <p className="sale__success-title">Condicional {draft.confirmed.code} salva!</p>
              <p className="sale__success-total">Total: {formatConditionalTotal(draft.confirmed.total)}</p>
              <div className="sale__success-actions">
                <button className="sale__continue" type="button" onClick={() => draft.reset()}>
                  Nova condicional
                </button>
                <button className="sale__back" type="button" onClick={() => navigate("/condicionais")}>
                  Ver condicionais
                </button>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Condicionais">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card">
              <p className="sale__cart-title">Quem está levando?</p>
              <div className="sale__who">
                <SearchCombobox<Contact>
                  id="condicional-cliente"
                  label="Cliente"
                  placeholder="Digite o nome ou o documento..."
                  value={draft.header.clienteNome}
                  onChange={(v) => {
                    draft.setField("clienteNome", v);
                    /* Digitar por cima de quem ja estava escolhido desfaz a
                       escolha - ver a nota do ClienteStep de Realizar Venda. */
                    if (draft.header.clienteId) draft.setField("clienteId", "");
                  }}
                  fetchItems={(query) => fetchContactsByKind("clientes", query)}
                  getKey={(c) => c.id}
                  renderItem={(c) => ({ primary: c.name, secondary: c.document })}
                  onSelect={(c) => draft.selectContact(c)}
                  onCreateNew={canCreateContact ? (query) => setCreatingContactName(query) : undefined}
                  createNewLabel="Cadastrar novo cliente"
                />
                <FormField
                  id="condicional-prazo"
                  label="Prazo de devolução"
                  type="date"
                  value={draft.header.dueDate}
                  onChange={(v) => draft.setField("dueDate", v)}
                />
              </div>
            </div>
          </div>

          <div className="sale__step-body sale__step-body--produtos">
            <div className="sale__products-panel">
              <ProductPickerPanel
                branchId={currentBranchId}
                onAddProduct={(p) => draft.addProduct(p)}
                hint="Clique ou arraste um produto para adicionar à condicional."
              />
            </div>

            <div className="sale__panel">
              <CartDropzone>
                {(isCartOver) => (
                  <>
                    <p className="sale__cart-title">Itens enviados</p>

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
                                type="text"
                                aria-label={`Preço unitário — ${line.product.description}`}
                                title="O preço vem do cadastro do produto — edite lá para mudar."
                                value={formatConditionalTotal(line.unitPrice)}
                                disabled
                                readOnly
                              />
                              <span className="sale__cart-line-total">{formatConditionalTotal(draft.lineTotal(line))}</span>
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
                        <span>{formatConditionalTotal(draft.total)}</span>
                      </div>
                    </div>

                    {draft.submitError && <p className="sale__error">{draft.submitError}</p>}
                    {!canCreate && <p className="sale__error">Você não tem permissão para criar condicionais.</p>}

                    <div className="sale__confirm-actions">
                      <button
                        className="sale__continue"
                        type="button"
                        disabled={!draft.canConfirm || !canCreate}
                        onClick={() => draft.confirm()}
                      >
                        {draft.submitting ? "Salvando..." : "Salvar condicional"}
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
