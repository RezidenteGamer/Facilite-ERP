import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";
import { extractErrorMessage } from "./useInvoicesData";

type CancelInvoiceModalProps = {
  saleCode: string;
  onSubmit: (justificativa: string) => Promise<void>;
  onDone: () => void;
};

/**
 * Justificativa de 15 a 255 caracteres é regra da SEFAZ — o
 * `SimulatedFiscalProvider` já valida (ver `src/lib/fiscal/simulatedFiscalProvider.ts`);
 * este modal deixa o usuário ver a recusa em vez de mascará-la, não tenta
 * adivinhar o limite antes de mandar.
 */
export default function CancelInvoiceModal({ saleCode, onSubmit, onDone }: CancelInvoiceModalProps) {
  const [justificativa, setJustificativa] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit(justificativa);
      onDone();
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível cancelar a nota.")]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Cancelar nota da venda {saleCode}</p>
            </Dialog.Title>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            <div className="registry-form-modal__fields">
              <FormField
                id="cancel-invoice-justificativa"
                label="Justificativa *"
                value={justificativa}
                onChange={setJustificativa}
                hint="De 15 a 255 caracteres — exigência da SEFAZ."
              />
            </div>

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
                disabled={submitting}
              >
                {submitting ? "Cancelando..." : "Cancelar nota"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
