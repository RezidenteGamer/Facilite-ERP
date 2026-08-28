import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import "../registry-engine/RegistryFormModal.css";
import FieldTypePicker from "./FieldTypePicker";
import { previewFieldKey, type NewModuleField } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

type FieldFormModalProps = {
  title: string;
  /** Valores de partida — edição de um campo existente ou de um ainda não gravado. */
  initial?: NewModuleField;
  /**
   * Chave já gravada no banco. Quando vem preenchida o campo já existe, e a
   * chave **não muda mais**: mesmo raciocínio de nunca renomear uma coluna de
   * banco em produção — se já houver registros, mudar a chave orfanaria o dado
   * antigo debaixo da chave velha. Sem ela, a chave ainda é preview do rótulo.
   */
  lockedKey?: string;
  submitLabel?: string;
  /**
   * Módulos genéricos que este campo pode referenciar. **Vazio esconde o
   * controle inteiro** — em vez de aparecer desabilitado com um cadeado
   * anunciando algo que a pessoa nunca vai poder usar. Desde que o construtor
   * inteiro passou a exigir `is_facilite_developer` (28/08/2026) a lista só
   * chega vazia por falta de módulo genérico elegível, não por falta de flag.
   *
   * Esconder o controle não solta o valor já gravado: `referenceModuleId`
   * continua no estado e volta intacto no submit, senão editar o rótulo de um
   * campo de referência apagaria a referência (e o banco recusaria a edição).
   */
  referenceChoices?: { id: string; label: string }[];
  onSubmit: (field: NewModuleField) => void;
  onCancel: () => void;
};

/**
 * Formulário de um campo **novo**. Depois de criado, o campo é editado no
 * próprio cartão do canvas (rótulo, tipo, flags e referência), então este
 * modal existe só para o momento em que ainda não há cartão para clicar.
 *
 * O tipo é escolhido por ícone (`FieldTypePicker`), como no cartão — os
 * mesmos cinco `data_type` que o motor genérico já conhece, nem um a mais.
 */
export default function FieldFormModal({
  title,
  initial,
  lockedKey,
  submitLabel = "Salvar",
  referenceChoices = [],
  onSubmit,
  onCancel,
}: FieldFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [dataType, setDataType] = useState<ModuleFieldDefinition["dataType"]>(
    initial?.dataType ?? "text",
  );
  const [isRequired, setIsRequired] = useState(initial?.isRequired ?? false);
  const [showInTable, setShowInTable] = useState(initial?.showInTable ?? true);
  const [showInDetails, setShowInDetails] = useState(initial?.showInDetails ?? true);
  const [showInForm, setShowInForm] = useState(initial?.showInForm ?? true);
  const [referenceModuleId, setReferenceModuleId] = useState(initial?.referenceModuleId ?? "");
  const [error, setError] = useState("");

  const key = lockedKey ?? previewFieldKey(label);

  function handleSubmit() {
    if (!label.trim()) {
      setError("Informe um rótulo para o campo.");
      return;
    }
    if (!key) {
      setError("O rótulo precisa ter pelo menos uma letra ou número.");
      return;
    }
    if (!showInTable && !showInDetails && !showInForm) {
      setError("O campo precisa aparecer em pelo menos um lugar (tabela, ficha ou formulário).");
      return;
    }
    setError("");
    onSubmit({
      label: label.trim(),
      dataType,
      isRequired,
      showInTable,
      showInDetails,
      showInForm,
      referenceModuleId: referenceModuleId || null,
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
                id="field-label"
                label="Rótulo *"
                value={label}
                onChange={setLabel}
                hint={
                  lockedKey
                    ? `Chave: ${lockedKey} — não muda, para não orfanar os dados já gravados`
                    : key
                      ? `Chave: ${key}`
                      : undefined
                }
              />

              <div className="module-builder__select-field">
                <span className="module-builder__select-label">Tipo</span>
                <FieldTypePicker value={dataType} onChange={setDataType} />
              </div>

              {referenceChoices.length > 0 && (
                <div className="module-builder__select-field">
                  <label className="module-builder__select-label" htmlFor="field-reference">
                    Referência a outro módulo
                  </label>
                  <select
                    id="field-reference"
                    className="module-builder__select"
                    value={referenceModuleId}
                    onChange={(event) => setReferenceModuleId(event.target.value)}
                  >
                    <option value="">Nenhuma (campo comum)</option>
                    {referenceChoices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <p className="module-builder__hint">
                    O campo passa a guardar um registro do módulo escolhido, e o formulário vira
                    uma lista de registros dele.
                  </p>
                </div>
              )}

              <div className="module-builder__checks">
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={isRequired}
                    onChange={(event) => setIsRequired(event.target.checked)}
                  />
                  Obrigatório
                </label>
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={showInTable}
                    onChange={(event) => setShowInTable(event.target.checked)}
                  />
                  Aparece na tabela
                </label>
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={showInDetails}
                    onChange={(event) => setShowInDetails(event.target.checked)}
                  />
                  Aparece na ficha
                </label>
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={showInForm}
                    onChange={(event) => setShowInForm(event.target.checked)}
                  />
                  Aparece no formulário
                </label>
              </div>
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
