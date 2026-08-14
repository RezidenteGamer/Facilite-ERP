import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import ProductPickerPanel from "../../../components/product-picker/ProductPickerPanel";
import { formatMoney } from "../sales";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

export const CART_DROPZONE_ID = "sale-cart-dropzone";

type ProdutosStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
  branchId: string | null;
};

/**
 * `useDroppable` só enxerga o `DndContext` quando chamado por um componente
 * renderizado DENTRO dele — chamar no mesmo componente que declara o
 * `<DndContext>` não funciona. Por isso o drop-target é um filho.
 */
function CartDropzone({ children }: { children: (isOver: boolean) => ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CART_DROPZONE_ID });
  return (
    <div className="sale__card" ref={setNodeRef}>
      {children(isOver)}
    </div>
  );
}

/** Etapa 2: produtos à esquerda (clique ou arraste), carrinho à direita — mesmo esquema de antes. */
export default function ProdutosStep({ draft, branchId }: ProdutosStepProps) {
  return (
    <div className="sale__step-body sale__step-body--produtos">
      <div className="sale__products-panel">
        <ProductPickerPanel branchId={branchId} onAddProduct={(p) => draft.addProduct(p)} />
      </div>

      <div className="sale__panel">
        <CartDropzone>
          {(isCartOver) => (
            <>
              <p className="sale__cart-title">Produtos da venda</p>

              <div className={`sale__cart-lines${isCartOver ? " sale__cart-lines--drop-active" : ""}`}>
                {draft.cart.length === 0 ? (
                  <p className="sale__cart-empty">Nenhum item adicionado ainda — comece buscando um produto acima.</p>
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
                          onChange={(e) => draft.updateLine(line.lineId, { quantity: Number(e.target.value) || 0 })}
                        />
                        <input
                          className="sale__cart-line-input"
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Preço unitário — ${line.product.description}`}
                          value={line.unitPrice}
                          onChange={(e) => draft.updateLine(line.lineId, { unitPrice: Number(e.target.value) || 0 })}
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

              {draft.lastRemoved?.kind === "cart" && (
                <div className="sale__undo" role="status">
                  <span>{`"${draft.lastRemoved.line.product.description}" removido.`}</span>
                  <button className="sale__undo-btn" type="button" onClick={draft.undoRemove}>
                    Desfazer
                  </button>
                </div>
              )}

              {draft.cart.length > 0 && (
                <div className="sale__totals-row sale__totals-row--total">
                  <span>Subtotal</span>
                  <span>{formatMoney(draft.subtotal)}</span>
                </div>
              )}
            </>
          )}
        </CartDropzone>
      </div>
    </div>
  );
}
