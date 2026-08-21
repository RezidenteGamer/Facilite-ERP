import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { ModuleSituation, TransitionInput } from "../modules/moduleWorkflow";
import "../registry-engine/RegistryFormModal.css";
import "./ModuleBuilderPage.css";

type TransitionFormModalProps = {
  title: string;
  situations: ModuleSituation[];
  initial?: TransitionInput;
  /**
   * O par de situações não se escolhe por `<select>`: numa transição já criada
   * ele é imutável (mudá-lo viraria o sentido das ações penduradas nela sem
   * que elas soubessem), e numa transição nova ele é o que os dois cliques no
   * diagrama acabaram de dizer.
   */
  lockPair?: boolean;
  submitLabel?: string;
  onSubmit: (input: TransitionInput) => void;
  onCancel: () => void;
};

export default function TransitionFormModal({
  title,
  situations,
  initial,
  lockPair = false,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: TransitionFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [fromSituationId, setFromSituationId] = useState(
    initial?.fromSituationId ?? situations[0]?.id ?? "",
  );
  const [toSituationId, setToSituationId] = useState(
    initial?.toSituationId ?? situations[1]?.id ?? "",
  );
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [error, setError] = useState("");

  const options = situations.map((situation) => ({
    value: situation.id,
    label: situation.label,
  }));

  function handleSubmit() {
    if (!label.trim()) {
      setError("Informe o texto do botão que o usuário vai ver.");
      return;
    }
    if (!fromSituationId || !toSituationId) {
      setError("Escolha a situação de origem e a de destino.");
      return;
    }
    if (fromSituationId === toSituationId) {
      setError("A transição precisa ir de uma situação para outra.");
      return;
    }
    setError("");
    onSubmit({
      id: initial?.id ?? null,
      fromSituationId,
      toSituationId,
      label: label.trim(),
      sortOrder: Number(sortOrder) || 0,
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
                id="transition-label"
                label="Texto do botão *"
                value={label}
                onChange={setLabel}
                hint='É o que aparece na ficha do registro (ex.: "Marcar como resolvido").'
              />

              <FormField
                id="transition-from"
                label="De"
                type="select"
                options={options}
                value={fromSituationId}
                onChange={setFromSituationId}
                disabled={lockPair}
              />

              <FormField
                id="transition-to"
                label="Para"
                type="select"
                options={options}
                value={toSituationId}
                onChange={setToSituationId}
                disabled={lockPair}
              />

              <FormField
                id="transition-order"
                label="Ordem"
                value={sortOrder}
                onChange={setSortOrder}
              />

              {lockPair && (
                <p className="module-builder__hint">
                  {initial?.id
                    ? "O caminho de uma transição não muda depois de criada — as ações configuradas nela mudariam de sentido em silêncio. Para mudar, exclua e recrie."
                    : "O caminho veio do diagrama: é a ligação que você acabou de desenhar. Cancele e ligue de novo se quiser outro sentido."}
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
