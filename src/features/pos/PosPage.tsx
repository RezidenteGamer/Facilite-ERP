import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "../../components/icons";
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
import { POS_PRODUCTS, formatMoney, type PosCategory, type PosProduct } from "./posProducts";
import "./PosPage.css";

const LOW_STOCK_DEFAULT = 15;

type CategoryFilter = "todos" | PosCategory;

const CATEGORY_LABEL: Record<PosCategory, string> = {
  vegetais: "Vegetais",
  automoveis: "Automóveis",
  outros: "Outros",
};

type CartLine = {
  product: PosProduct;
  quantity: number;
};

type PaymentMethod = "dinheiro" | "debito" | "credito" | "pix" | "dividir";

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: typeof CardIcon }[] = [
  { id: "dinheiro", label: "Dinheiro", icon: CardIcon },
  { id: "debito", label: "Débito", icon: CardIcon },
  { id: "credito", label: "Crédito", icon: CardIcon },
  { id: "pix", label: "PIX", icon: PixIcon },
  { id: "dividir", label: "Dividir", icon: SplitIcon },
];

function productBadge(product: PosProduct): { label: string; tone: "low" | "out" } | null {
  if (product.stock <= 0) return { label: "Sem estoque", tone: "out" };
  if (product.stock <= (product.lowStockThreshold ?? LOW_STOCK_DEFAULT)) {
    return { label: "Estoque baixo", tone: "low" };
  }
  return null;
}

/** Módulo "Ponto de venda" — tela cheia, sem a moldura padrão (kiosk de caixa). */
export default function PosPage() {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("todos");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [client, setClient] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<"percent" | "value">("percent");
  const [payment, setPayment] = useState<PaymentMethod>("dinheiro");
  const [received, setReceived] = useState("");

  // "outros" não vira aba própria — os produtos continuam visíveis em "Todos".
  const categories = useMemo(() => {
    const found = new Set(POS_PRODUCTS.map((p) => p.category));
    found.delete("outros");
    return Array.from(found);
  }, []);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return POS_PRODUCTS.filter((p) => {
      const matchesCategory = category === "todos" || p.category === category;
      const matchesTerm = !term || p.name.toLowerCase().includes(term) || p.id.includes(term);
      return matchesCategory && matchesTerm;
    });
  }, [category, search]);

  function addToCart(product: PosProduct) {
    if (product.stock <= 0) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.product.id === productId ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLast() {
    setCart((current) => current.slice(0, -1));
  }

  const subtotal = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const discountValue = Number(discount.replace(",", ".")) || 0;
  const discountAmount = discountMode === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const total = Math.max(0, subtotal - discountAmount);
  const receivedValue = Number(received.replace(",", ".")) || 0;
  const troco = Math.max(0, receivedValue - total);

  function confirmSale() {
    if (cart.length === 0) return;
    // Sem back-end ainda: só limpa a venda atual.
    setCart([]);
    setClient("");
    setDiscount("");
    setReceived("");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "F4") {
        event.preventDefault();
        confirmSale();
      } else if (event.key === "Escape") {
        event.preventDefault();
        removeLast();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

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
            <div className="pos__tabs" role="tablist">
              <button
                className={`pos__tab${category === "todos" ? " pos__tab--active" : ""}`}
                type="button"
                onClick={() => setCategory("todos")}
              >
                Todos
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`pos__tab${category === cat ? " pos__tab--active" : ""}`}
                  type="button"
                  onClick={() => setCategory(cat)}
                >
                  {CATEGORY_LABEL[cat]}
                </button>
              ))}
            </div>

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
              return (
                <button
                  key={product.id}
                  className="pos__card"
                  type="button"
                  disabled={outOfStock}
                  onClick={() => addToCart(product)}
                >
                  {badge && <span className={`pos__badge pos__badge--${badge.tone}`}>{badge.label}</span>}
                  <span
                    className="pos__card-image"
                    style={{ background: product.placeholder.color }}
                    aria-hidden="true"
                  >
                    {product.placeholder.label}
                  </span>
                  <span className="pos__card-body">
                    <span className="pos__card-name">{product.name}</span>
                    <span className="pos__card-price">{formatMoney(product.price)}</span>
                    <span className="pos__card-stock">Estoque: {product.stock}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pos__toolbar">
            <button type="button" aria-label="Focar câmera">
              <CropIcon />
            </button>
            <button type="button" aria-label="Digitar código">
              T
            </button>
            <button type="button" aria-label="Editar produto">
              <PencilIcon />
            </button>
            <button type="button" aria-label="Capturar foto">
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
              <button type="button" aria-label="Pausar venda">
                <PauseIcon />
              </button>
              <button type="button" aria-label="Retomar venda">
                <PlayIcon />
              </button>
              <button type="button" aria-label="Cancelar venda" onClick={() => setCart([])}>
                <CancelSaleIcon />
              </button>
            </div>
          </div>

          <div className="pos__cart-items">
            {cart.length === 0 ? (
              <p className="pos__cart-empty">Adicione produtos à venda</p>
            ) : (
              cart.map((line) => (
                <div className="pos__cart-line" key={line.product.id}>
                  <div className="pos__cart-line-info">
                    <span className="pos__cart-line-name">{line.product.name}</span>
                    <span className="pos__cart-line-price">{formatMoney(line.product.price)} un.</span>
                  </div>
                  <div className="pos__cart-line-qty">
                    <button type="button" onClick={() => changeQuantity(line.product.id, -1)}>
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button type="button" onClick={() => changeQuantity(line.product.id, 1)}>
                      +
                    </button>
                  </div>
                  <span className="pos__cart-line-total">
                    {formatMoney(line.product.price * line.quantity)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="pos__cart-footer">
            <input
              className="pos__client"
              type="text"
              placeholder="Cliente (opcional) — buscar por nome ou CPF"
              value={client}
              onChange={(event) => setClient(event.target.value)}
            />

            <div className="pos__discount-row">
              <span>Desconto:</span>
              <input
                className="pos__discount-input"
                type="text"
                inputMode="decimal"
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
              />
              <div className="pos__discount-toggle">
                <button
                  type="button"
                  className={discountMode === "percent" ? "pos__discount-toggle--active" : ""}
                  onClick={() => setDiscountMode("percent")}
                >
                  %
                </button>
                <button
                  type="button"
                  className={discountMode === "value" ? "pos__discount-toggle--active" : ""}
                  onClick={() => setDiscountMode("value")}
                >
                  R$
                </button>
              </div>
            </div>

            <div className="pos__totals">
              <div className="pos__totals-row">
                <span>Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="pos__totals-row pos__totals-row--total">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <div className="pos__payments">
              {PAYMENT_METHODS.map((method) => {
                const Icon = method.icon;
                return (
                  <button
                    key={method.id}
                    type="button"
                    className={`pos__payment${payment === method.id ? " pos__payment--active" : ""}`}
                    onClick={() => setPayment(method.id)}
                  >
                    <Icon />
                    <span>{method.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="pos__received-row">
              <label>
                Recebido:
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={received}
                  onChange={(event) => setReceived(event.target.value)}
                />
              </label>
              <span className="pos__troco">Troco: {formatMoney(troco)}</span>
            </div>

            <button
              className="pos__confirm"
              type="button"
              disabled={cart.length === 0}
              onClick={confirmSale}
            >
              Confirmar Venda — {formatMoney(total)}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
