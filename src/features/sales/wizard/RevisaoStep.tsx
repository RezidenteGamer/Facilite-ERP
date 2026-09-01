import { parseAmount } from "../../../lib/amount";
import { formatMoney, SALE_PAYMENT_METHOD_LABEL } from "../sales";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

type RevisaoStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
};

const DETALHES_FIELDS: { key: keyof ReturnType<typeof useSaleDraft>["header"]; label: string }[] = [
  { key: "tipoOperacao", label: "Tipo de operação" },
  { key: "departamento", label: "Departamento" },
  { key: "endereco", label: "Endereço" },
  { key: "centroCustos", label: "Centro de custos" },
  { key: "enderecoEntrega", label: "Endereço de entrega" },
  { key: "dataSaida", label: "Data de saída" },
];

/** Etapa 5: resumo só-leitura — nada aqui é editável, é a última chance de conferir antes de confirmar. */
export default function RevisaoStep({ draft }: RevisaoStepProps) {
  const filledDetalhes = DETALHES_FIELDS.filter(({ key }) => draft.header[key]);

  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Revisão</p>

        <section className="sale__review-section">
          <h3>Cliente e vendedor</h3>
          <div className="sale__totals-row">
            <span>Cliente</span>
            <span>{draft.header.clienteNome || "—"}</span>
          </div>
          <div className="sale__totals-row">
            <span>Vendedor</span>
            <span>{draft.header.vendedorNome || "—"}</span>
          </div>
        </section>

        <section className="sale__review-section">
          <h3>Itens ({draft.cart.length})</h3>
          {draft.cart.length === 0 ? (
            <p className="sale__cart-empty">Nenhum item adicionado.</p>
          ) : (
            draft.cart.map((line) => (
              <div className="sale__totals-row" key={line.lineId}>
                <span>
                  {line.product.description} × {line.quantity}
                </span>
                <span>{formatMoney(draft.lineTotal(line))}</span>
              </div>
            ))
          )}
        </section>

        {filledDetalhes.length > 0 && (
          <section className="sale__review-section">
            <h3>Detalhes da operação</h3>
            {filledDetalhes.map(({ key, label }) => (
              <div className="sale__totals-row" key={key}>
                <span>{label}</span>
                <span>{draft.header[key]}</span>
              </div>
            ))}
          </section>
        )}

        <section className="sale__review-section">
          <h3>Pagamento</h3>
          {draft.payments.length === 0 ? (
            <p className="sale__cart-empty">Nenhuma forma de pagamento adicionada.</p>
          ) : (
            draft.payments.map((payment) => (
              <div className="sale__totals-row" key={payment.lineId}>
                <span>
                  {SALE_PAYMENT_METHOD_LABEL[payment.method]}
                  {payment.method === "credito" ? ` — ${payment.installments}x` : ""}
                </span>
                <span>{formatMoney(parseAmount(payment.amount) ?? 0)}</span>
              </div>
            ))
          )}
        </section>

        <section className="sale__review-section">
          <h3>Totais</h3>
          <div className="sale__totals-row">
            <span>Subtotal</span>
            <span>{formatMoney(draft.subtotal)}</span>
          </div>
          {draft.freightValue > 0 && (
            <div className="sale__totals-row">
              <span>Frete</span>
              <span>{formatMoney(draft.freightValue)}</span>
            </div>
          )}
          {draft.discountValue > 0 && (
            <div className="sale__totals-row">
              <span>Desconto</span>
              <span>-{formatMoney(draft.discountValue)}</span>
            </div>
          )}
          <div className="sale__totals-row sale__totals-row--total">
            <span>Total</span>
            <span>{formatMoney(draft.total)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
