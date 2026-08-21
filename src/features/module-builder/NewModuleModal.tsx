import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import "../registry-engine/RegistryFormModal.css";
import FieldFormModal from "./FieldFormModal";
import FieldTypeIcon from "./FieldTypeIcon";
import {
  FIELD_TYPES,
  previewFieldKey,
  previewModuleId,
  type NewModuleField,
  type NewModuleInput,
} from "./moduleBuilder";
import "./ModuleBuilderPage.css";

const DEFAULT_SORT_ORDER = 200;

function typeLabel(value: ModuleFieldDefinition["dataType"]): string {
  return FIELD_TYPES.find((type) => type.value === value)?.label ?? value;
}

/**
 * Criação de um módulo do usuário: nome, isolamento por filial, ordem e os
 * campos.
 *
 * O que **não** aparece aqui é tão deliberado quanto o que aparece. Não há
 * escolha de `access_gate` (todo módulo criado por usuário usa `permission`;
 * os outros cinco valores são de telas administrativas do sistema) nem de
 * ícone (usa o genérico de reserva — upload de imagem é outro assunto). O
 * banco fixa esses valores dentro de `create_user_module`, então nem um
 * cliente adulterado consegue criar um módulo com portão administrativo.
 */
export default function NewModuleModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: NewModuleInput) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [branchScoped, setBranchScoped] = useState(false);
  const [sortOrder, setSortOrder] = useState(String(DEFAULT_SORT_ORDER));
  const [fields, setFields] = useState<NewModuleField[]>([]);
  const [fieldModal, setFieldModal] = useState<{ index: number | null } | null>(null);
  const [error, setError] = useState("");

  const moduleId = previewModuleId(label);

  function handleSubmit() {
    if (!label.trim()) {
      setError("Informe um nome para o módulo.");
      return;
    }
    if (!moduleId) {
      setError("O nome precisa ter pelo menos uma letra ou número.");
      return;
    }
    if (fields.length === 0) {
      setError("Adicione pelo menos um campo — um módulo sem campos não guarda nada.");
      return;
    }
    const parsedOrder = Number(sortOrder);
    if (!Number.isFinite(parsedOrder)) {
      setError("A ordem precisa ser um número.");
      return;
    }
    setError("");
    onSubmit({ label: label.trim(), branchScoped, sortOrder: parsedOrder, fields });
  }

  function saveField(field: NewModuleField) {
    const index = fieldModal?.index ?? null;
    const key = previewFieldKey(field.label);
    const clash = fields.some((existing, i) => i !== index && previewFieldKey(existing.label) === key);
    if (clash) {
      setError(`Dois campos gerariam a mesma chave (${key}). Use rótulos diferentes.`);
      setFieldModal(null);
      return;
    }
    setError("");
    setFields((current) =>
      index === null
        ? [...current, field]
        : current.map((item, i) => (i === index ? field : item)),
    );
    setFieldModal(null);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content
            className="registry-form-modal module-builder__new-module"
            aria-describedby={undefined}
          >
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Novo módulo</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}

            <div className="registry-form-modal__fields">
              <FormField
                id="new-module-label"
                label="Nome *"
                value={label}
                onChange={setLabel}
                hint={moduleId ? `Rota: /${moduleId} (não muda depois de criado)` : undefined}
              />
              <FormField
                id="new-module-order"
                label="Ordem na tela inicial"
                value={sortOrder}
                onChange={setSortOrder}
              />

              <div className="module-builder__checks">
                <label className="module-builder__check">
                  <input
                    type="checkbox"
                    checked={branchScoped}
                    onChange={(event) => setBranchScoped(event.target.checked)}
                  />
                  Isolado por filial
                </label>
              </div>
            </div>

            <div className="module-builder__fields-block">
              <div className="module-builder__fields-head">
                <span className="module-builder__fields-title">Campos</span>
                <button
                  className="module-builder__btn module-builder__btn--small"
                  type="button"
                  onClick={() => setFieldModal({ index: null })}
                >
                  Adicionar campo
                </button>
              </div>

              {fields.length === 0 ? (
                <p className="module-builder__empty">Nenhum campo ainda.</p>
              ) : (
                <ul className="module-builder__field-list">
                  {fields.map((field, index) => (
                    <li key={`${field.label}-${index}`} className="module-builder__field-item">
                      <span className="module-builder__field-label">
                        {field.label}
                        {field.isRequired && " *"}
                      </span>
                      <span className="module-builder__field-meta">
                        {/* Ícone no lugar do nome do tipo, como no canvas — o
                            nome continua legível pelo `title`/`aria-label`. */}
                        <FieldTypeIcon
                          dataType={field.dataType}
                          className="module-builder__field-glyph"
                          role="img"
                          aria-label={typeLabel(field.dataType)}
                        />
                        {previewFieldKey(field.label)}
                      </span>
                      <div className="module-builder__field-actions">
                        <button
                          className="module-builder__link"
                          type="button"
                          onClick={() => setFieldModal({ index })}
                        >
                          Editar
                        </button>
                        <button
                          className="module-builder__link module-builder__link--danger"
                          type="button"
                          onClick={() =>
                            setFields((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          Remover
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
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
                Criar módulo
              </button>
            </div>

            {/* Dentro do `Dialog.Content` de propósito: é assim que o Radix
                empilha um modal sobre outro sem fechar o de baixo no clique —
                mesmo padrão do `LookupModal` no `RegistryFormModal`. */}
            {fieldModal && (
              <FieldFormModal
                title={fieldModal.index === null ? "Novo campo" : "Editar campo"}
                /* Sem `lockedKey`: o campo ainda não existe no banco, então a
                   chave continua sendo preview do rótulo e muda junto com ele. */
                initial={fieldModal.index === null ? undefined : fields[fieldModal.index]}
                submitLabel={fieldModal.index === null ? "Adicionar" : "Salvar"}
                onSubmit={saveField}
                onCancel={() => setFieldModal(null)}
              />
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
