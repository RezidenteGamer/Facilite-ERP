import { AlertIcon, CheckIcon } from "../../../components/icons";
import { formatMoney, SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "../sales";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

const PAYMENT_METHODS: SalePaymentMethod[] = ["dinheiro", "debito", "credito", "pix", "boleto", "outro"];

type FaturamentoStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
};

/** Etapa 4: formas de pagamento — Troco/Restante são calculados na hora, não gravados. */
export default function FaturamentoStep({ draft }: FaturamentoStepProps) {
  const restante = Math.max(0, draft.total - draft.paymentsTotal);
  const troco = Math.max(0, draft.paymentsTotal - draft.total);

  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Faturamento</p>

        <div className="sale__payments">
          <div className="sale__payments-header">
            <strong>Formas de pagamento</strong>
            {draft.payments.length > 0 && (
              <button className="sale__payments-add" type="button" onClick={() => draft.addPayment()}>
                + Adicionar pagamento
              </button>
            )}
          </div>

          {draft.payments.length === 0 ? (
            <div className="sale__payments-empty">
              <p>A venda precisa de ao menos uma forma de pagamento.</p>
              <button
                className="sale__payments-add sale__payments-add--big"
                type="button"
                onClick={() => draft.addPayment()}
              >
                + Adicionar forma de pagamento
              </button>
            </div>
          ) : (
            <>
              <div className="sale__payment-line sale__payment-line--head" aria-hidden="true">
                <span>Forma</span>
                <span>Valor</span>
                <span>Parcelas</span>
                <span />
              </div>
              {draft.payments.map((payment, index) => (
                <div className="sale__payment-line" key={payment.lineId}>
                  <select
                    className="sale__payment-select"
                    aria-label={`Forma de pagamento ${index + 1}`}
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
                    aria-label={`Valor do pagamento ${index + 1}`}
                    value={payment.amount}
                    onChange={(e) => draft.updatePayment(payment.lineId, { amount: Number(e.target.value) || 0 })}
                  />
                  {payment.method === "credito" && (
                    <input
                      className="sale__cart-line-input sale__cart-line-input--narrow"
                      type="number"
                      min={1}
                      step="1"
                      aria-label={`Número de parcelas — pagamento ${index + 1}`}
                      value={payment.installments}
                      onChange={(e) =>
                        draft.updatePayment(payment.lineId, { installments: Number(e.target.value) || 1 })
                      }
                    />
                  )}
                  <button
                    className="sale__cart-line-remove"
                    type="button"
                    aria-label={`Remover pagamento ${index + 1}`}
                    onClick={() => draft.removePayment(payment.lineId)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {draft.lastRemoved?.kind === "payment" && (
          <div className="sale__undo" role="status">
            <span>Forma de pagamento removida.</span>
            <button className="sale__undo-btn" type="button" onClick={draft.undoRemove}>
              Desfazer
            </button>
          </div>
        )}

        <div className="sale__totals">
          <div className="sale__totals-row">
            <span>Subtotal</span>
            <span>{formatMoney(draft.subtotal)}</span>
          </div>
          <div className="sale__totals-row sale__totals-row--total">
            <span>Total</span>
            <span>{formatMoney(draft.total)}</span>
          </div>
          <div className={`sale__totals-row${draft.paymentsMatch ? " sale__totals-row--ok" : " sale__totals-row--warn"}`}>
            <span className="sale__totals-payments-label">
              Pagamentos
              {draft.payments.length > 0 &&
                (draft.paymentsMatch ? (
                  <CheckIcon className="sale__totals-status-icon" aria-hidden="true" />
                ) : (
                  <AlertIcon className="sale__totals-status-icon" aria-hidden="true" />
                ))}
            </span>
            <span>{formatMoney(draft.paymentsTotal)}</span>
          </div>

          {restante > 0 && draft.payments.length > 0 && (
            <div className="sale__totals-row sale__totals-row--warn">
              <span>Restante</span>
              <span>{formatMoney(restante)}</span>
            </div>
          )}
          {troco > 0 && (
            <div className="sale__totals-row sale__totals-row--ok">
              <span>Troco</span>
              <span>{formatMoney(troco)}</span>
            </div>
          )}
        </div>

        {draft.payments.length > 0 && !draft.paymentsMatch && (
          <p className="sale__error">
            {draft.paymentsTotal < draft.total
              ? `Falta ${formatMoney(draft.total - draft.paymentsTotal)} em formas de pagamento para confirmar.`
              : `Os pagamentos somam ${formatMoney(draft.paymentsTotal - draft.total)} a mais que o total da venda.`}
          </p>
        )}
      </div>
    </div>
  );
}
