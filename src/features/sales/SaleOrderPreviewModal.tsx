import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { fetchSaleOrderWithItems, type SaleOrderDetail } from "../../lib/repositories/saleOrdersRepository";
import "../registry-engine/RegistryFormModal.css";
import "./SaleOrderPreviewModal.css";
import { SALE_ORDER_STATUS_LABEL, formatOrderDate, formatOrderTotal } from "./saleOrders";
import { SALE_PAYMENT_METHOD_LABEL } from "./sales";
import { extractErrorMessage } from "./useInvoicesData";

type SaleOrderPreviewModalProps = {
  saleOrderId: string;
  onClose: () => void;
};

/**
 * Pré-visualização somente-leitura de um pedido: cabeçalho + itens + total.
 *
 * **Modal bespoke, não o motor genérico** — mesmo critério já documentado em
 * `SaleReturnModal`/`FinanceEntryPlanModal`: isto é a ficha de um registro
 * já existente com uma lista de itens dentro, não um formulário de campos.
 * Busca o pedido de novo (`fetchSaleOrderWithItems`) em vez de reaproveitar
 * a linha da listagem porque a listagem nunca fez join com os itens.
 */
export default function SaleOrderPreviewModal({ saleOrderId, onClose }: SaleOrderPreviewModalProps) {
  const [order, setOrder] = useState<SaleOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSaleOrderWithItems(saleOrderId)
      .then((detail) => {
        if (!cancelled) setOrder(detail);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, "Não foi possível carregar o pedido."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [saleOrderId]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal sale-order-preview-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{order ? `Pedido ${order.code}` : "Pedido de venda"}</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}
            {loading && <p className="sale-order-preview-modal__hint">Carregando o pedido...</p>}

            {order && !loading && (
              <>
                <div className="sale-order-preview-modal__header">
                  <div>
                    <span className="sale-order-preview-modal__label">Cliente</span>
                    <span>{order.contactName}</span>
                  </div>
                  <div>
                    <span className="sale-order-preview-modal__label">Vendedor</span>
                    <span>{order.sellerName}</span>
                  </div>
                  <div>
                    <span className="sale-order-preview-modal__label">Emissão</span>
                    <span>{formatOrderDate(order.issueDate)}</span>
                  </div>
                  <div>
                    <span className="sale-order-preview-modal__label">Forma de pagamento</span>
                    <span>
                      {SALE_PAYMENT_METHOD_LABEL[order.paymentMethod]} ({order.installments}x)
                    </span>
                  </div>
                  <div>
                    <span className="sale-order-preview-modal__label">Situação</span>
                    <span>{SALE_ORDER_STATUS_LABEL[order.status]}</span>
                  </div>
                </div>

                <div className="sale-order-preview-modal__lines">
                  <div className="sale-order-preview-modal__line sale-order-preview-modal__line--head">
                    <span>Produto</span>
                    <span>Qtd.</span>
                    <span>Preço unit.</span>
                    <span>Total</span>
                  </div>

                  {order.items.map((item) => (
                    <div key={item.id} className="sale-order-preview-modal__line">
                      <span className="sale-order-preview-modal__product">
                        {item.productCode} — {item.productDescription}
                      </span>
                      <span>{item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</span>
                      <span>{formatOrderTotal(item.unitPrice)}</span>
                      <span>{formatOrderTotal(item.totalAmount)}</span>
                    </div>
                  ))}
                </div>

                <p className="sale-order-preview-modal__total">Total do pedido: {formatOrderTotal(order.totalAmount)}</p>

                <div className="sale-order-preview-modal__print" aria-hidden="true">
                  <div className="sale-order-preview-modal__print-header">
                    <span className="sale-order-preview-modal__print-brand">Facilite</span>
                    <div className="sale-order-preview-modal__print-meta">
                      <span>Orçamento {order.code}</span>
                      <span>Emitido em {formatOrderDate(order.issueDate)}</span>
                    </div>
                  </div>

                  <div className="sale-order-preview-modal__print-info">
                    <div>
                      <span className="sale-order-preview-modal__label">Cliente</span>
                      <span>{order.contactName}</span>
                    </div>
                    <div>
                      <span className="sale-order-preview-modal__label">Vendedor</span>
                      <span>{order.sellerName}</span>
                    </div>
                    <div>
                      <span className="sale-order-preview-modal__label">Forma de pagamento</span>
                      <span>
                        {SALE_PAYMENT_METHOD_LABEL[order.paymentMethod]} ({order.installments}x)
                      </span>
                    </div>
                    <div>
                      <span className="sale-order-preview-modal__label">Situação</span>
                      <span>{SALE_ORDER_STATUS_LABEL[order.status]}</span>
                    </div>
                  </div>

                  <table className="sale-order-preview-modal__print-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Qtd.</th>
                        <th>Preço unit.</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            {item.productCode} — {item.productDescription}
                          </td>
                          <td>{item.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</td>
                          <td>{formatOrderTotal(item.unitPrice)}</td>
                          <td>{formatOrderTotal(item.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="sale-order-preview-modal__print-total">
                    Total do pedido: {formatOrderTotal(order.totalAmount)}
                  </p>

                  <p className="sale-order-preview-modal__print-footer">
                    Orçamento válido conforme condições combinadas.
                  </p>
                </div>
              </>
            )}

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onClose}
              >
                Fechar
              </button>
              {order && !loading && (
                <button
                  className="registry-form-modal__btn registry-form-modal__btn--confirm"
                  type="button"
                  onClick={() => window.print()}
                >
                  Imprimir orçamento
                </button>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
