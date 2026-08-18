import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";
import { parseAmount } from "../finance/finance";
import { extractErrorMessage } from "../finance/useFinancialEntriesData";
import type { CashRegister } from "./cashControl";

type OpenCashSessionModalProps = {
  registers: CashRegister[];
  onSubmit: (input: { registerId: string; openingAmount: number }) => Promise<void>;
  onCancel: () => void;
};

/**
 * Modal de abertura de caixa — feito à mão (dois campos não justificam o
 * motor genérico nem `RegistryFormModal`), mesmo recorte de
 * `FinanceEntryPlanModal`. O seletor de caixa normalmente tem uma opção só
 * (catálogo simples, sem UI de administração nesta etapa), mas o campo
 * existe para não fechar a porta de mais de um caixa por filial.
 */
export default function OpenCashSessionModal({ registers, onSubmit, onCancel }: OpenCashSessionModalProps) {
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? "");
  const [openingAmountText, setOpeningAmountText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const list: string[] = [];
    if (!registerId) list.push("Selecione um caixa.");
    const amount = parseAmount(openingAmountText);
    if (amount === null) list.push("Valor de abertura precisa ser um número válido.");
    else if (amount < 0) list.push("Valor de abertura não pode ser negativo.");
    if (list.length > 0) {
      setErrors(list);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({ registerId, openingAmount: amount as number });
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível abrir o caixa.")]);
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
              <p>Abrir caixa</p>
            </Dialog.Title>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            <div className="registry-form-modal__fields">
              <div className="form-field">
                <label className="form-field__label" htmlFor="open-cash-register">
                  Caixa
                </label>
                <div className="form-field__control">
                  <select
                    id="open-cash-register"
                    className="form-field__input"
                    value={registerId}
                    onChange={(event) => setRegisterId(event.target.value)}
                  >
                    {registers.length === 0 && <option value="">Nenhum caixa cadastrado</option>}
                    {registers.map((register) => (
                      <option key={register.id} value={register.id}>
                        {register.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <FormField
                id="open-cash-amount"
                label="Valor de abertura *"
                value={openingAmountText}
                onChange={setOpeningAmountText}
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
                {submitting ? "Abrindo..." : "Abrir caixa"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
