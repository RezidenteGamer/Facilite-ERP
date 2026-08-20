import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { SituationInput } from "../modules/moduleWorkflow";
import "../registry-engine/RegistryFormModal.css";
import { previewFieldKey } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

type SituationFormModalProps = {
  title: string;
  initial?: SituationInput;
  /**
   * Código já gravado. Como `field_key`, ele **não muda mais** depois de
   * criado: é o que está em `module_records.status`, e trocá-lo orfanaria a
   * situação de todos os registros que já estão nela.
   */
  lockedCode?: string;
  /** Situação inicial atual não pode ser desmarcada — só substituída. */
  lockInitial?: boolean;
  submitLabel?: string;
  onSubmit: (input: SituationInput) => void;
  onCancel: () => void;
};

export default function SituationFormModal({
  title,
  initial,
  lockedCode,
  lockInitial = false,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: SituationFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [isInitial, setIsInitial] = useState(initial?.isInitial ?? false);
  const [error, setError] = useState("");

  const code = lockedCode ?? previewFieldKey(label);

  function handleSubmit() {
    if (!label.trim()) {
      setError("Informe um nome para a situação.");
      return;
    }
    if (!code) {
      setError("O nome precisa ter pelo menos uma letra ou número.");
      return;
    }
    setError("");
    onSubmit({
      id: initial?.id ?? null,
      label: label.trim(),
      sortOrder: Number(sortOrder) || 0,
      isInitial,
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}

            <div className="registry-form-modal__fields">
              <FormField
                id="situation-label"
                label="Nome da situação *"
                value={label}
                onChange={setLabel}
                hint={
                  lockedCode
                    ? `Código: ${lockedCode} — não muda, para não orfanar os registros que já estão nela`
                    : code
                      ? `Código: ${code}`
                      : undefined
                }
              />

              <FormField
                id="situation-order"
                label="Ordem"
                value={sortOrder}
                onChange={setSortOrder}
              />

              <div className="module-builder__checks">
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={isInitial}
                    disabled={lockInitial}
                    onChange={(event) => setIsInitial(event.target.checked)}
                  />
                  Situação inicial (todo registro novo nasce nela)
                </label>
              </div>

              {lockInitial && (
                <p className="module-builder__hint">
                  Esta já é a situação inicial. Para trocar, marque outra como inicial — o módulo
                  não pode ficar sem nenhuma.
                </p>
              )}
            </div>

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
              >
                {submitLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
