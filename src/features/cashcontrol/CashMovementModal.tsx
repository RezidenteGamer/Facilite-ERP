import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";
import { parseAmount } from "../finance/finance";
import { extractErrorMessage } from "../finance/useFinancialEntriesData";
import { CASH_MOVEMENT_TYPE_LABEL, type CashMovementType } from "./cashControl";

type CashMovementModalProps = {
  type: CashMovementType;
  sessionLabel: string;
  onSubmit: (input: { amount: number; description: string }) => Promise<void>;
  onCancel: () => void;
};

/** Modal de sangria/suprimento — mesmo componente para os dois, só troca o rótulo pelo `type`. */
export default function CashMovementModal({ type, sessionLabel, onSubmit, onCancel }: CashMovementModalProps) {
  const [amountText, setAmountText] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const title = CASH_MOVEMENT_TYPE_LABEL[type];

  async function handleSubmit() {
    const amount = parseAmount(amountText);
    const list: string[] = [];
    if (amount === null) list.push("Valor precisa ser um número válido.");
    else if (amount <= 0) list.push("Valor precisa ser maior que zero.");
    if (list.length > 0) {
      setErrors(list);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({ amount: amount as number, description });
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível lançar a movimentação.")]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            <p style={{ margin: "-8px 0 12px", fontSize: 13, opacity: 0.75 }}>{sessionLabel}</p>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            <div className="registry-form-modal__fields">
              <FormField id="cash-movement-amount" label="Valor *" value={amountText} onChange={setAmountText} />
              <FormField
                id="cash-movement-description"
                label="Descrição"
                value={description}
                onChange={setDescription}
              />
            </div>

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
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
                {submitting ? "Lançando..." : "Lançar"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
