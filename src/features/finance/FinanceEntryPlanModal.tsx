import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import FormField from "../../components/form/FormField";
import LookupModal from "../../components/form/LookupModal";
import type { Contact } from "../customers/contacts";
import "../registry-engine/RegistryFormModal.css";
import "./FinanceEntryPlanModal.css";
import {
  computeInstallmentPreview,
  parseAmount,
  type FinanceEntryPlanInput,
  type FinanceEntryType,
} from "./finance";
import { extractErrorMessage } from "./useFinancialEntriesData";

type FinanceEntryPlanModalProps = {
  type: FinanceEntryType;
  contactLabel: string;
  fetchContacts: (query: string) => Promise<Contact[]>;
  onSubmit: (input: FinanceEntryPlanInput) => Promise<void>;
  onCancel: () => void;
};

/**
 * Modal de criação do Financeiro — feito à mão, fora do motor genérico.
 *
 * `RegistryFormModal` só sabe `text`/`date` por campo (mais os dois props de
 * ponte já existentes, `mediaField`/`lookupField`). Este formulário precisa
 * de parcelamento (nº de parcelas + intervalo, com prévia calculada ao
 * vivo) e um checkbox ("já foi pago/recebido") — um terceiro prop de ponte
 * só por causa deste campo teria sido o motor se distorcendo para caber um
 * módulo só. A listagem e a ficha do Financeiro continuam 100% no motor
 * genérico (`module_fields`/`RegistryTable`/`RegistryDetails`); só a
 * criação é bespoke — mesmo recorte já usado em Realizar Venda/Pedidos de
 * venda, que também são telas feitas à mão ao lado de módulos genéricos.
 */
export default function FinanceEntryPlanModal({
  type,
  contactLabel,
  fetchContacts,
  onSubmit,
  onCancel,
}: FinanceEntryPlanModalProps) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [totalText, setTotalText] = useState("");
  const [installmentCountText, setInstallmentCountText] = useState("1");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [intervalDaysText, setIntervalDaysText] = useState("30");
  const [settled, setSettled] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const total = parseAmount(totalText);
  const installmentCount = Number.parseInt(installmentCountText, 10);
  const intervalDays = Number.parseInt(intervalDaysText, 10);

  const preview = useMemo(() => {
    if (total === null || total <= 0) return [];
    if (!Number.isInteger(installmentCount) || installmentCount < 1) return [];
    if (!Number.isInteger(intervalDays) || intervalDays < 1) return [];
    if (!firstDueDate) return [];
    return computeInstallmentPreview(total, installmentCount, firstDueDate, intervalDays);
  }, [total, installmentCount, intervalDays, firstDueDate]);

  function validate(): string[] {
    const list: string[] = [];
    if (total === null) list.push("Valor total precisa ser um número válido.");
    else if (total <= 0) list.push("Valor total precisa ser maior que zero.");
    if (!Number.isInteger(installmentCount) || installmentCount < 1) {
      list.push("Número de parcelas inválido.");
    }
    if (!Number.isInteger(intervalDays) || intervalDays < 1) {
      list.push("Intervalo entre parcelas inválido.");
    }
    if (!firstDueDate) list.push("Informe o vencimento da 1ª parcela.");
    return list;
  }

  async function handleSubmit() {
    const validationErrors = validate();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({
        type,
        contactId: contact?.id ?? null,
        paymentMethod: paymentMethod || undefined,
        document: documentText || undefined,
        total: total as number,
        installmentCount,
        firstDueDate,
        intervalDays,
        settled,
      });
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível lançar a conta.")]);
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
              <p>{type === "a_pagar" ? "Nova conta a pagar" : "Nova conta a receber"}</p>
            </Dialog.Title>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            <div className="registry-form-modal__fields">
              <FormField
                id="finance-plan-contact"
                label={contactLabel}
                value={contact?.name ?? ""}
                onChange={() => {}}
                lookup
                onLookup={() => setLookupOpen(true)}
              />
              <FormField
                id="finance-plan-payment-method"
                label="Forma de pagamento"
                value={paymentMethod}
                onChange={setPaymentMethod}
              />
              <FormField id="finance-plan-document" label="Documento" value={documentText} onChange={setDocumentText} />
              <FormField
                id="finance-plan-total"
                label="Valor total da operação *"
                value={totalText}
                onChange={setTotalText}
              />

              <div className="finance-entry-plan__row">
                <FormField
                  id="finance-plan-installments"
                  label="Parcelas *"
                  value={installmentCountText}
                  onChange={setInstallmentCountText}
                />
                <FormField
                  id="finance-plan-interval"
                  label="Intervalo (dias) *"
                  value={intervalDaysText}
                  onChange={setIntervalDaysText}
                  hint="30 = mensal"
                />
              </div>

              <FormField
                id="finance-plan-first-due"
                label="Vencimento da 1ª parcela *"
                type="date"
                value={firstDueDate}
                onChange={setFirstDueDate}
              />

              <label className="finance-entry-plan__checkbox">
                <input
                  type="checkbox"
                  checked={settled}
                  onChange={(event) => setSettled(event.target.checked)}
                />
                {type === "a_pagar" ? "Já foi pago" : "Já foi recebido"}
              </label>

              {preview.length > 0 && (
                <div className="finance-entry-plan__preview">
                  <p className="finance-entry-plan__preview-title">Prévia das parcelas</p>
                  <ul className="finance-entry-plan__preview-list">
                    {preview.map((installment) => (
                      <li key={installment.number} className="finance-entry-plan__preview-item">
                        <span>{installment.number}/{preview.length}</span>
                        <span>{installment.dueDateFormatted}</span>
                        <span>{installment.amountFormatted}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

            {lookupOpen && (
              <LookupModal<Contact>
                title={`Selecionar ${contactLabel.toLowerCase()}`}
                placeholder="Buscar por nome ou documento..."
                fetchItems={fetchContacts}
                getKey={(c) => c.id}
                renderItem={(c) => ({ primary: c.name, secondary: c.document })}
                onClose={() => setLookupOpen(false)}
                onSelect={(c) => {
                  setContact(c);
                  setLookupOpen(false);
                }}
              />
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
