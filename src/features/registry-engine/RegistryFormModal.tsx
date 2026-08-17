import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import LookupModal from "../../components/form/LookupModal";
import PhotoDropzone from "./PhotoDropzone";
import type { ModuleFieldDefinition } from "./types";
import "./RegistryFormModal.css";

type RegistryFormModalMediaField = {
  label: string;
  imageUrl?: string | null;
  hint?: string;
  uploading?: boolean;
  onFileSelected: (file: File) => void;
};

/**
 * Ponte para um campo de consulta a outro cadastro (ex.: o contato de um
 * lançamento do Financeiro) dentro do formulário genérico.
 *
 * Mesmo papel de `mediaField`: `module_fields` não tem um `dataType` de
 * consulta, e criar um seria generalizar o motor inteiro por causa de um
 * campo. O modal renderiza o `LookupModal` já existente e cuida de abrir e
 * fechar; quem consome só diz o que buscar e o que fazer com o escolhido.
 */
type RegistryFormModalLookupField<TItem> = {
  label: string;
  /** Descrição do item já escolhido. Vazio = nada escolhido ainda. */
  value: string;
  isRequired?: boolean;
  modalTitle: string;
  searchPlaceholder?: string;
  fetchItems: (query: string) => Promise<TItem[]>;
  getKey: (item: TItem) => string;
  renderItem: (item: TItem) => { primary: string; secondary?: string };
  onSelect: (item: TItem) => void;
};

type RegistryFormModalProps<TItem> = {
  title: string;
  fields: ModuleFieldDefinition[];
  initialValues?: Record<string, string>;
  submitLabel?: string;
  mediaField?: RegistryFormModalMediaField;
  lookupField?: RegistryFormModalLookupField<TItem>;
  /**
   * Validação além de "preenchido/vazio" — mesmo papel do `validateRow` do
   * motor de lote (`RegistryBatchFormModal`). Devolve mensagens de erro
   * prontas (não nomes de campo); quem usa decide a regra (ex.: Financeiro
   * recusa "abc" ou valor <= 0 no campo Valor total).
   */
  validate?: (values: Record<string, string>) => string[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
};

/**
 * Formulário de criação/edição genérico: renderiza um `FormField` por campo
 * de metadados do módulo (`showInForm`), sem conhecer o domínio do módulo.
 * Usada tanto para "Novo" quanto "Editar" — a diferença é só `initialValues`.
 */
export default function RegistryFormModal<TItem = unknown>({
  title,
  fields,
  initialValues,
  submitLabel = "Salvar",
  mediaField,
  lookupField,
  validate,
  onSubmit,
  onCancel,
}: RegistryFormModalProps<TItem>) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.accessorKey] = initialValues?.[field.accessorKey] ?? "";
    }
    return initial;
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [lookupOpen, setLookupOpen] = useState(false);

  function handleSubmit() {
    const missing = fields
      .filter((field) => field.isRequired && !values[field.accessorKey]?.trim())
      .map((field) => field.label);
    if (lookupField?.isRequired && !lookupField.value.trim()) {
      missing.unshift(lookupField.label);
    }

    const errors: string[] = [];
    if (missing.length > 0) {
      errors.push(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
    }
    errors.push(...(validate?.(values) ?? []));

    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    onSubmit(values);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {formErrors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            {mediaField && (
              <div className="registry-form-modal__media">
                <PhotoDropzone
                  imageUrl={mediaField.imageUrl}
                  hint={mediaField.hint ?? "Ou arraste para cá"}
                  uploading={mediaField.uploading}
                  onFileSelected={mediaField.onFileSelected}
                />
                <span className="registry-form-modal__media-label">{mediaField.label}</span>
              </div>
            )}

            <div className="registry-form-modal__fields">
              {lookupField && (
                <FormField
                  id="registry-form-lookup"
                  label={lookupField.isRequired ? `${lookupField.label} *` : lookupField.label}
                  value={lookupField.value}
                  /* O valor só muda pelo modal de busca — digitar não faz nada
                     de propósito, para não existir contato "de texto livre". */
                  onChange={() => {}}
                  lookup
                  onLookup={() => setLookupOpen(true)}
                />
              )}

              {fields.map((field) => (
                <FormField
                  key={field.accessorKey}
                  id={`registry-form-${field.accessorKey}`}
                  label={field.isRequired ? `${field.label} *` : field.label}
                  type={field.dataType === "date" ? "date" : "text"}
                  value={values[field.accessorKey] ?? ""}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.accessorKey]: value }))
                  }
                />
              ))}
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

            {/* Dentro do `Dialog.Content` de propósito: é assim que o Radix
                empilha um modal sobre outro sem que o de baixo se feche ao
                clique. O `LookupModal` tem portal próprio, então não afeta
                o layout daqui. */}
            {lookupField && lookupOpen && (
              <LookupModal<TItem>
                title={lookupField.modalTitle}
                placeholder={lookupField.searchPlaceholder}
                fetchItems={lookupField.fetchItems}
                getKey={lookupField.getKey}
                renderItem={lookupField.renderItem}
                onClose={() => setLookupOpen(false)}
                onSelect={(item) => {
                  lookupField.onSelect(item);
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
