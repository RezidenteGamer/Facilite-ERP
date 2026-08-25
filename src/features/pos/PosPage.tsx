import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SearchIcon } from "../../components/icons";
import SearchCombobox from "../../components/form/SearchCombobox";
import { useAuth } from "../auth/AuthContext";
import { useProductsData } from "../products/useProductsData";
import type { Product } from "../products/products";
import type { Contact } from "../customers/contacts";
import QuickContactFormModal from "../customers/QuickContactFormModal";
import { fetchContactsByKind } from "../../lib/repositories/contactLookups";
import { normalizeSearchText } from "../../lib/searchText";
import {
  CancelSaleIcon,
  CardIcon,
  CartIcon,
  CropIcon,
  FrameIcon,
  GridViewIcon,
  ListViewIcon,
  PauseIcon,
  PencilIcon,
  PixIcon,
  PlayIcon,
  SplitIcon,
} from "./icons";
import { formatMoney, productPlaceholder } from "./pos";
import { useOpenCashSession, usePosSale, type PosPaymentMethod } from "./usePosSale";
import "./PosPage.css";

const LOW_STOCK_DEFAULT = 15;

const PAYMENT_METHODS: { id: PosPaymentMethod | "dividir"; label: string; icon: typeof CardIcon }[] = [
  { id: "dinheiro", label: "Dinheiro", icon: CardIcon },
  { id: "debito", label: "Débito", icon: CardIcon },
  { id: "credito", label: "Crédito", icon: CardIcon },
  { id: "pix", label: "PIX", icon: PixIcon },
  { id: "dividir", label: "Dividir", icon: SplitIcon },
];

const SPLIT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito: "Crédito",
  pix: "PIX",
};

function formatPausedTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function productBadge(product: Product): { label: string; tone: "low" | "out" } | null {
  if (product.stock <= 0) return { label: "Sem estoque", tone: "out" };
  if (product.stock <= LOW_STOCK_DEFAULT) return { label: "Estoque baixo", tone: "low" };
  return null;
}

/** Módulo "Ponto de venda" — tela cheia, sem a moldura padrão (kiosk de caixa). */
export default function PosPage() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const { hasPermission, currentBranchId, profile, user } = useAuth();
  const sellerId = profile?.id ?? user?.id ?? null;
  const canCreate = hasPermission("ponto-de-venda", "create");
  /* Sem permissao de criar contato o atalho some - oferecer um cadastro que a
     RLS vai recusar so produz erro. */
  const canCreateContact = hasPermission("clientes-fornecedores", "create");

  const { products } = useProductsData(currentBranchId);
  const { session: openSession, loading: sessionLoading, reload: reloadSession } = useOpenCashSession(currentBranchId);
  const sale = usePosSale(currentBranchId, sellerId);

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  /* O texto digitado no campo de cliente e do campo, nao do contato
     escolhido: os dois so coincidem enquanto ninguem estiver buscando outro. */
  const [clientQuery, setClientQuery] = useState("");
  /** Nome digitado que originou o "Cadastrar novo" - `null` = modal fechado. */
  const [creatingContactName, setCreatingContactName] = useState<string | null>(null);
  const [showPausedList, setShowPausedList] = useState(false);
  const resumeWrapperRef = useRef<HTMLDivElement>(null);
  const qtyHoldTimer = useRef<number | null>(null);

  // Fecha a lista de vendas pausadas ao clicar fora dela.
  useEffect(() => {
    if (!showPausedList) return;
    function handlePointerDown(event: PointerEvent) {
      if (resumeWrapperRef.current?.contains(event.target as Node)) return;
      setShowPausedList(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showPausedList]);

  // Recarrega a sessão depois de uma venda confirmada — o extrato do Controle
  // de caixa nesta sessão muda, e uma segunda sessão pode ter sido aberta
  // em outra aba nesse meio-tempo.
  useEffect(() => {
    if (sale.confirmedSale) reloadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.confirmedSale]);

  // Segurar +/- repete a mudança de quantidade sozinho. `cartRef` existe
  // porque o intervalo é criado uma única vez no mousedown/touchstart e
  // precisa enxergar o carrinho atualizado a cada tick, não o de quando
  // começou a segurar.
  const cartRef = useRef(sale.cart);
  useEffect(() => {
    cartRef.current = sale.cart;
  }, [sale.cart]);

  useEffect(() => {
    return () => {
      if (qtyHoldTimer.current !== null) window.clearInterval(qtyHoldTimer.current);
    };
  }, []);

  function stopQtyHold() {
    if (qtyHoldTimer.current !== null) {
      window.clearInterval(qtyHoldTimer.current);
      qtyHoldTimer.current = null;
    }
  }

  function startQtyHold(lineId: string, delta: number) {
    stopQtyHold();
    function tick() {
      const line = cartRef.current.find((current) => current.lineId === lineId);
      if (!line) {
        stopQtyHold();
        return;
      }
      if (delta > 0 && line.quantity >= line.product.stock) {
        stopQtyHold();
        return;
      }
      sale.changeQuantity(lineId, delta);
    }
    tick();
    qtyHoldTimer.current = window.setInterval(tick, 180);
  }

  // Sem taxonomia de categoria: `products.type` é campo livre sem dado
  // estruturado hoje (a categoria vegetais/automóveis/outros do mock era só
  // exemplo) — ver AGENTS.md. Filtra só por busca e produto ativo.
  const visibleProducts = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    return products.filter((product) => {
      if (!product.active) return false;
      if (!term) return true;
      return normalizeSearchText(product.description).includes(term) || normalizeSearchText(product.code).includes(term);
    });
  }, [products, search]);

  const canConfirm =
    canCreate && !sessionLoading && !!openSession && sale.cart.length > 0 && sale.paymentValid && !sale.submitting;

  function handleConfirm() {
    if (!canConfirm) return;
    void sale.confirmSale(!!openSession);
  }

  useEffect(() => {
    function isTypingInField() {
      const active = document.activeElement;
      return active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingInField()) return;
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "F4") {
        event.preventDefault();
        handleConfirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        sale.removeLast();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.cart, canConfirm]);

  return (
    <div className="pos">
      <header className="pos__topbar">
        <div className="pos__brand">
          <CartIcon />
          <strong>PDV</strong>
          <span className="pos__store">Facilite LTDA</span>
        </div>

        <div className="pos__shortcuts">
          <span>F2: Buscar</span>
          <span className="pos__shortcuts-sep">|</span>
          <span>F4: Confirmar</span>
          <span className="pos__shortcuts-sep">|</span>
          <span>ESC: Remover último</span>
        </div>

        <button className="pos__back" type="button" onClick={() => navigate(-1)}>
          <span aria-hidden="true">←</span> Voltar
        </button>
      </header>

      <div className="pos__body">
        <main className="pos__main">
          <div className="pos__search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              placeholder="Buscar produto por nome ou código (scanner)..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="pos__filters">
            <div className="pos__view-toggle">
              <button
                className={`pos__view-btn${view === "grid" ? " pos__view-btn--active" : ""}`}
                type="button"
                aria-label="Ver em grade"
                onClick={() => setView("grid")}
              >
                <GridViewIcon />
              </button>
              <button
                className={`pos__view-btn${view === "list" ? " pos__view-btn--active" : ""}`}
                type="button"
                aria-label="Ver em lista"
                onClick={() => setView("list")}
              >
                <ListViewIcon />
              </button>
            </div>
          </div>

          <div className={`pos__grid${view === "list" ? " pos__grid--list" : ""}`}>
            {visibleProducts.map((product) => {
              const badge = productBadge(product);
              const outOfStock = product.stock <= 0;
              const placeholder = productPlaceholder(product.description, product.code);
              return (
                <button
                  key={product.id}
                  className="pos__card"
                  type="button"
                  disabled={outOfStock}
                  onClick={() => sale.addProduct(product)}
                >
                  {badge && <span className={`pos__badge pos__badge--${badge.tone}`}>{badge.label}</span>}
                  {product.photoUrl ? (
                    <img
                      className="pos__card-image"
                      src={product.photoUrl}
                      alt=""
                      aria-hidden="true"
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <span className="pos__card-image" style={{ background: placeholder.color }} aria-hidden="true">
                      {placeholder.label}
                    </span>
                  )}
                  <span className="pos__card-body">
                    <span className="pos__card-name">{product.description}</span>
                    <span className="pos__card-price">{formatMoney(product.salePrice)}</span>
                    <span className="pos__card-stock">Estoque: {product.stock}</span>
                  </span>
                </button>
              );
            })}
            {visibleProducts.length === 0 && <p className="pos__cart-empty">Nenhum produto encontrado.</p>}
          </div>

          <div className="pos__toolbar">
            <button type="button" aria-label="Focar câmera" title="Scanner de código de barras (não implementado)">
              <CropIcon />
            </button>
            <button type="button" aria-label="Digitar código" title="Digitar código (não implementado)">
              T
            </button>
            <button type="button" aria-label="Editar produto" title="Editar produto (não implementado)">
              <PencilIcon />
            </button>
            <button type="button" aria-label="Capturar foto" title="Capturar foto (não implementado)">
              <FrameIcon />
            </button>
          </div>
        </main>

        <aside className="pos__cart">
          <div className="pos__cart-header">
            <div className="pos__cart-title">
              <CartIcon />
              Venda Atual
            </div>
            <div className="pos__cart-controls">
              <button type="button" aria-label="Pausar venda" title="Pausar venda" onClick={sale.pauseSale}>
                <PauseIcon />
              </button>
              <div className="pos__resume-wrapper" ref={resumeWrapperRef}>
                <button
                  type="button"
                  aria-label="Retomar venda"
                  title={sale.pausedSales.length === 0 ? "Nenhuma venda pausada" : "Retomar venda"}
                  disabled={sale.pausedSales.length === 0}
                  onClick={() => setShowPausedList((current) => !current)}
                >
                  <PlayIcon />
                </button>
                {showPausedList && sale.pausedSales.length > 0 && (
                  <div className="pos__resume-list">
                    {sale.pausedSales.map((paused) => (
                      <button
                        key={paused.id}
                        type="button"
                        className="pos__resume-item"
                        onClick={() => {
                          sale.resumeSale(paused.id);
                          setShowPausedList(false);
                        }}
                      >
                        <span className="pos__resume-item-name">{paused.contact?.name ?? "Sem cliente"}</span>
                        <span className="pos__resume-item-meta">
                          {paused.cart.reduce((sum, line) => sum + line.quantity, 0)} itens ·{" "}
                          {formatMoney(paused.total)} · {formatPausedTime(paused.pausedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" aria-label="Cancelar venda" onClick={sale.reset}>
                <CancelSaleIcon />
              </button>
            </div>
          </div>

          <div className="pos__cart-items">
            {sale.cart.length === 0 ? (
              <p className="pos__cart-empty">Adicione produtos à venda</p>
            ) : (
              sale.cart.map((line) => (
                <div className="pos__cart-line" key={line.lineId}>
                  <div className="pos__cart-line-info">
                    <span className="pos__cart-line-name">{line.product.description}</span>
                    <span className="pos__cart-line-price">{formatMoney(line.product.salePrice)} un.</span>
                  </div>
                  <div className="pos__cart-line-qty">
                    <button
                      type="button"
                      onMouseDown={() => startQtyHold(line.lineId, -1)}
                      onMouseUp={stopQtyHold}
                      onMouseLeave={stopQtyHold}
                      onTouchStart={() => startQtyHold(line.lineId, -1)}
                      onTouchEnd={stopQtyHold}
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      disabled={line.quantity >= line.product.stock}
                      onMouseDown={() => startQtyHold(line.lineId, 1)}
                      onMouseUp={stopQtyHold}
                      onMouseLeave={stopQtyHold}
                      onTouchStart={() => startQtyHold(line.lineId, 1)}
                      onTouchEnd={stopQtyHold}
                    >
                      +
                    </button>
                  </div>
                  <span className="pos__cart-line-total">
                    {formatMoney(line.product.salePrice * line.quantity)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="pos__cart-footer">
            {!sessionLoading && !openSession && (
              <div className="pos__session-warning" role="alert">
                <span>Abra uma sessão de caixa antes de vender.</span>
                <Link to="/controle-caixa">Abrir no Controle de caixa →</Link>
              </div>
            )}

            <div className="pos__client-row">
              <SearchCombobox<Contact>
                id="pos-cliente"
                className="pos__client-combobox"
                label="Cliente (opcional)"
                hideLabel
                placeholder="Cliente (opcional) — digite o nome ou o CPF"
                value={clientQuery}
                onChange={(text) => {
                  setClientQuery(text);
                  /* Digitar por cima do cliente escolhido desfaz a escolha — a
                     nota fiscal sai com quem o campo estiver mostrando. */
                  if (sale.contact) sale.setContact(null);
                }}
                fetchItems={(query) => fetchContactsByKind("clientes", query)}
                getKey={(c) => c.id}
                renderItem={(c) => ({ primary: c.name, secondary: c.document })}
                onSelect={(c) => {
                  sale.setContact(c);
                  setClientQuery(c.name);
                }}
                onCreateNew={canCreateContact ? (query) => setCreatingContactName(query) : undefined}
                createNewLabel="Cadastrar novo cliente"
              />
              {sale.contact && (
                <button
                  type="button"
                  className="pos__client-clear"
                  aria-label="Remover cliente selecionado"
                  onClick={() => {
                    sale.setContact(null);
                    setClientQuery("");
                  }}
                >
                  ×
                </button>
              )}
            </div>

            <div className="pos__discount-row">
              <span>Desconto:</span>
              <input
                className="pos__discount-input"
                type="text"
                inputMode="decimal"
                value={sale.discount}
                onChange={(event) => sale.setDiscount(event.target.value)}
              />
              <div className="pos__discount-toggle">
                <button
                  type="button"
                  className={sale.discountMode === "percent" ? "pos__discount-toggle--active" : ""}
                  onClick={() => sale.setDiscountMode("percent")}
                >
                  %
                </button>
                <button
                  type="button"
                  className={sale.discountMode === "value" ? "pos__discount-toggle--active" : ""}
                  onClick={() => sale.setDiscountMode("value")}
                >
                  R$
                </button>
              </div>
            </div>

            <div className="pos__totals">
              <div className="pos__totals-row">
                <span>Subtotal</span>
                <span>{formatMoney(sale.subtotal)}</span>
              </div>
              <div className="pos__totals-row pos__totals-row--total">
                <span>Total</span>
                <span>{formatMoney(sale.total)}</span>
              </div>
            </div>

            <div className="pos__payments">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                return (
                  <button
                    key={method.id}
                    type="button"
                    className={`pos__payment${sale.method === method.id ? " pos__payment--active" : ""}`}
                    onClick={() => sale.selectMethod(method.id)}
                  >
                    <Icon />
                    <span>{method.label}</span>
                  </button>
                );
              })}
            </div>

            {sale.method === "dinheiro" && (
              <div className="pos__received-row">
                <label>
                  Recebido:
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={sale.received}
                    onChange={(event) => sale.setReceived(event.target.value)}
                  />
                </label>
                <span className="pos__troco">Troco: {formatMoney(sale.troco)}</span>
              </div>
            )}

            {sale.method === "credito" && (
              <div className="pos__received-row">
                <label>
                  Parcelas:
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={sale.installments}
                    onChange={(event) => sale.setInstallments(Math.max(1, Number(event.target.value) || 1))}
                  />
                </label>
              </div>
            )}

            {sale.method === "dividir" && (
              <div className="pos__split">
                {sale.splitLines.map((line, index) => (
                  <div className="pos__split-line" key={line.lineId}>
                    <select
                      aria-label={`Forma de pagamento ${index + 1}`}
                      value={line.method}
                      onChange={(event) =>
                        sale.updateSplitLine(line.lineId, { method: event.target.value as PosPaymentMethod })
                      }
                    >
                      {Object.entries(SPLIT_METHOD_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={`Valor do pagamento ${index + 1}`}
                      value={line.amount === 0 ? "" : String(line.amount)}
                      onChange={(event) =>
                        sale.updateSplitLine(line.lineId, { amount: Number(event.target.value.replace(",", ".")) || 0 })
                      }
                    />
                    {line.method === "credito" && (
                      <input
                        className="pos__split-installments"
                        type="number"
                        min={1}
                        step={1}
                        aria-label={`Parcelas do pagamento ${index + 1}`}
                        value={line.installments}
                        onChange={(event) =>
                          sale.updateSplitLine(line.lineId, {
                            installments: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="pos__split-remove"
                      aria-label={`Remover pagamento ${index + 1}`}
                      onClick={() => sale.removeSplitLine(line.lineId)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="pos__split-add" onClick={sale.addSplitLine}>
                  + Adicionar forma de pagamento
                </button>
                <div
                  className={`pos__split-summary${sale.splitMatches ? " pos__split-summary--ok" : " pos__split-summary--warn"}`}
                >
                  <span>Somado: {formatMoney(sale.splitTotal)}</span>
                  {!sale.splitMatches && <span>Falta bater com o total de {formatMoney(sale.total)}.</span>}
                </div>
              </div>
            )}

            {sale.submitError && <p className="pos__error">{sale.submitError}</p>}
            {sale.confirmedSale && (
              <p className="pos__success">Venda {sale.confirmedSale.code} confirmada.</p>
            )}
            {sale.fiscalWarning && <p className="pos__fiscal-warning">{sale.fiscalWarning}</p>}
            {!canCreate && <p className="pos__error">Sem permissão para vender no ponto de venda.</p>}

            <button className="pos__confirm" type="button" disabled={!canConfirm} onClick={handleConfirm}>
              Confirmar Venda — {formatMoney(sale.total)}
            </button>
          </div>
        </aside>
      </div>

      {creatingContactName !== null && (
        <QuickContactFormModal
          kind="clientes"
          initialName={creatingContactName}
          onCancel={() => setCreatingContactName(null)}
          onCreated={(contact) => {
            sale.setContact(contact);
            setClientQuery(contact.name);
            setCreatingContactName(null);
          }}
        />
      )}
    </div>
  );
}
