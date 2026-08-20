import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import {
  fetchConditionalDetail,
  type ConditionalDetail,
} from "../../lib/repositories/conditionalsRepository";
import { SALE_PAYMENT_METHOD_LABEL, type SalePaymentMethod } from "../sales/sales";
import { extractErrorMessage } from "../sales/useInvoicesData";
import "../registry-engine/RegistryFormModal.css";
import "../sales/SaleReturnModal.css";
import { formatConditionalQuantity, formatConditionalTotal, parseConditionalQuantity } from "./conditionals";

const PAYMENT_METHODS: SalePaymentMethod[] = ["dinheiro", "debito", "credito", "pix", "boleto", "outro"];

type ResolveItemInput = { conditionalItemId: string; quantity: number };

type ConditionalResolveModalProps =
  | {
      mode: "return";
      conditionalId: string;
      onSubmit: (input: { reason: string; items: ResolveItemInput[] }) => Promise<void>;
      onDone: () => void;
    }
  | {
      mode: "convert";
      conditionalId: string;
      onSubmit: (input: {
        paymentMethod: SalePaymentMethod;
        installments: number;
        items: ResolveItemInput[];
      }) => Promise<void>;
      onDone: () => void;
    };

/**
 * "Registrar devolução" e "Converter em venda" operam sobre a mesma coisa —
 * por item da condicional já selecionada, quanto resta (`remainingQuantity`)
 * e quanto o operador quer resolver agora, com o mesmo teto por linha que
 * `SaleReturnModal` já construiu em Devolução de venda. A diferença entre os
 * dois modos é só o que acontece ao confirmar (RPC diferente) e que
 * "converter" também pede a forma de pagamento — nada foi cobrado ainda.
 *
 * Não precisa de `LookupModal` para escolher a condicional: ela já é a
 * selecionada na tela.
 */
export default function ConditionalResolveModal(props: ConditionalResolveModalProps) {
  const { mode, conditionalId, onDone } = props;
  const [detail, setDetail] = useState<ConditionalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>("dinheiro");
  const [installments, setInstallments] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchConditionalDetail(conditionalId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) setErrors([extractErrorMessage(err, "Erro ao carregar a condicional.")]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conditionalId]);

  const lines = (detail?.items ?? []).map((item) => {
    const typed = quantities[item.conditionalItemId] ?? "";
    const quantity = parseConditionalQuantity(typed);
    const invalid = typed.trim() !== "" && quantity === null;
    const overLimit = quantity !== null && quantity > item.remainingQuantity;
    const total = quantity !== null && quantity > 0 && !overLimit ? quantity * item.unitPrice : 0;
    return { item, typed, quantity, invalid, overLimit, total };
  });

  const previewTotal = lines.reduce((sum, line) => sum + line.total, 0);

  async function handleSubmit() {
    const problems: string[] = [];
    const items: ResolveItemInput[] = [];

    for (const line of lines) {
      if (line.typed.trim() === "") continue;
      if (line.invalid) {
        problems.push(`${line.item.productDescription}: quantidade precisa ser um número válido.`);
        continue;
      }
      if (line.quantity === null || line.quantity <= 0) {
        problems.push(`${line.item.productDescription}: quantidade precisa ser maior que zero.`);
        continue;
      }
      if (line.overLimit) {
        problems.push(
          `${line.item.productDescription}: só restam ${formatConditionalQuantity(line.item.remainingQuantity)} ` +
            `(enviados ${formatConditionalQuantity(line.item.quantity)}, já resolvidos ` +
            `${formatConditionalQuantity(line.item.returnedQuantity + line.item.convertedQuantity)}).`,
        );
        continue;
      }
      items.push({ conditionalItemId: line.item.conditionalItemId, quantity: line.quantity });
    }

    if (items.length === 0 && problems.length === 0) {
      problems.push(
        mode === "return"
          ? "Informe a quantidade devolvida de ao menos um item."
          : "Informe a quantidade a converter de ao menos um item.",
      );
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      if (props.mode === "return") {
        await props.onSubmit({ reason: reason.trim(), items });
      } else {
        await props.onSubmit({ paymentMethod, installments, items });
      }
      onDone();
    } catch (err) {
      setErrors([
        extractErrorMessage(
          err,
          mode === "return" ? "Não foi possível registrar a devolução." : "Não foi possível converter em venda.",
        ),
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "return" ? "Registrar devolução" : "Converter em venda";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal sale-return-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            {loading && <p className="sale-return-modal__hint">Carregando os itens da condicional...</p>}

            {detail && !loading && (
              <>
                <p className="sale-return-modal__hint">
                  Condicional {detail.code} · {detail.clientName}
                </p>

                <div className="sale-return-modal__lines">
                  <div className="sale-return-modal__line sale-return-modal__line--head">
                    <span>Produto</span>
                    <span>Enviado</span>
                    <span>Resolvido</span>
                    <span>{mode === "return" ? "Devolver" : "Converter"}</span>
                    <span>Valor</span>
                  </div>

                  {lines.map((line) => (
                    <div
                      key={line.item.conditionalItemId}
                      className={`sale-return-modal__line${
                        line.item.remainingQuantity <= 0 ? " sale-return-modal__line--exhausted" : ""
                      }`}
                    >
                      <span className="sale-return-modal__product">
                        {line.item.productCode} — {line.item.productDescription}
                      </span>
                      <span>{formatConditionalQuantity(line.item.quantity)}</span>
                      <span>{formatConditionalQuantity(line.item.returnedQuantity + line.item.convertedQuantity)}</span>
                      <span>
                        <input
                          className={`sale-return-modal__qty${
                            line.invalid || line.overLimit ? " sale-return-modal__qty--error" : ""
                          }`}
                          type="text"
                          inputMode="decimal"
                          aria-label={`Quantidade — ${line.item.productDescription}`}
                          value={line.typed}
                          disabled={line.item.remainingQuantity <= 0}
                          placeholder={
                            line.item.remainingQuantity <= 0
                              ? "—"
                              : `até ${formatConditionalQuantity(line.item.remainingQuantity)}`
                          }
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [line.item.conditionalItemId]: event.target.value,
                            }))
                          }
                        />
                      </span>
                      <span>{formatConditionalTotal(line.total)}</span>
                    </div>
                  ))}
                </div>

                <p className="sale-return-modal__total">
                  {mode === "return" ? "Total a devolver" : "Total a converter"}: {formatConditionalTotal(previewTotal)}
                </p>

                {mode === "return" && (
                  <div className="registry-form-modal__fields">
                    <label className="form-field">
                      <span className="form-field__label">Motivo</span>
                      <input
                        className="form-field__input"
                        type="text"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                  </div>
                )}

                {mode === "convert" && (
                  <div className="sale__who">
                    <label className="form-field">
                      <span className="form-field__label">Forma de pagamento</span>
                      <select
                        className="sale__payment-select"
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as SalePaymentMethod)}
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {SALE_PAYMENT_METHOD_LABEL[method]}
                          </option>
                        ))}
                      </select>
                    </label>

                    {paymentMethod === "credito" && (
                      <label className="form-field">
                        <span className="form-field__label">Parcelas</span>
                        <input
                          className="sale__cart-line-input"
                          type="number"
                          min={1}
                          step="1"
                          value={installments}
                          onChange={(e) => setInstallments(Number(e.target.value) || 1)}
                        />
                      </label>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onDone}
                disabled={submitting}
              >
                Voltar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !detail}
              >
                {submitting ? "Salvando..." : mode === "return" ? "Confirmar devolução" : "Confirmar conversão"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
