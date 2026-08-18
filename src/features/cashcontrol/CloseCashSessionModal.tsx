import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";
import { parseAmount } from "../finance/finance";
import { extractErrorMessage } from "../finance/useFinancialEntriesData";
import { closeOutcomeLabel, type CashSession } from "./cashControl";

type CloseCashSessionModalProps = {
  session: CashSession;
  onSubmit: (input: { countedAmount: number }) => Promise<CashSession>;
  onDone: () => void;
};

/**
 * Modal de fechamento em duas fases: pede o valor contado, chama a RPC (que
 * calcula esperado/diferença) e então mostra o resultado — "bateu / sobrou /
 * faltou" — antes de fechar. `onDone` fecha o modal nos dois casos
 * (cancelar antes de confirmar, ou "Ok" depois do resultado); o hook já
 * recarregou a lista de sessões no meio do caminho.
 */
export default function CloseCashSessionModal({ session, onSubmit, onDone }: CloseCashSessionModalProps) {
  const [countedAmountText, setCountedAmountText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CashSession | null>(null);

  async function handleSubmit() {
    const amount = parseAmount(countedAmountText);
    if (amount === null) {
      setErrors(["Valor contado precisa ser um número válido."]);
      return;
    }
    if (amount < 0) {
      setErrors(["Valor contado não pode ser negativo."]);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      const closed = await onSubmit({ countedAmount: amount });
      setResult(closed);
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível fechar o caixa.")]);
    } finally {
      setSubmitting(false);
    }
  }

  const difference = result?.difference ?? 0;
  const differenceTone = difference === 0 ? "var(--positive)" : difference > 0 ? "var(--positive)" : "var(--danger)";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            {result ? (
              <>
                <Dialog.Title className="registry-form-modal__title" asChild>
                  <p>Caixa {result.code} fechado</p>
                </Dialog.Title>

                <div className="registry-form-modal__fields">
                  <p style={{ margin: 0, padding: "0 6px" }}>Valor esperado: {result.expectedAmountFormatted}</p>
                  <p style={{ margin: 0, padding: "0 6px" }}>Valor contado: {result.countedAmountFormatted}</p>
                  <p style={{ margin: 0, padding: "0 6px", fontWeight: 600, color: differenceTone }}>
                    {closeOutcomeLabel(difference)}
                  </p>
                </div>

                <div className="registry-form-modal__actions">
                  <button
                    className="registry-form-modal__btn registry-form-modal__btn--confirm"
                    type="button"
                    onClick={onDone}
                  >
                    Ok
                  </button>
                </div>
              </>
            ) : (
              <>
                <Dialog.Title className="registry-form-modal__title" asChild>
                  <p>Fechar caixa {session.code}</p>
                </Dialog.Title>

                {errors.map((message, index) => (
                  <p key={index} className="registry-form-modal__error">
                    {message}
                  </p>
                ))}

                <div className="registry-form-modal__fields">
                  <p style={{ margin: 0, padding: "0 6px" }}>Valor de abertura: {session.openingAmountFormatted}</p>
                  <FormField
                    id="close-cash-counted"
                    label="Valor contado *"
                    value={countedAmountText}
                    onChange={setCountedAmountText}
                  />
                </div>

                <div className="registry-form-modal__actions">
                  <button
                    className="registry-form-modal__btn registry-form-modal__btn--cancel"
                    type="button"
                    onClick={onDone}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                  <button
                    className="registry-form-modal__btn registry-form-modal__btn--confirm"
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? "Fechando..." : "Fechar caixa"}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
