import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { ModuleFieldDefinition } from "./types";
import "./RegistryFormModal.css";

type RegistryFormModalProps = {
  title: string;
  fields: ModuleFieldDefinition[];
  initialValues?: Record<string, string>;
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
};

/**
 * Formulário de criação/edição genérico: renderiza um `FormField` por campo
 * de metadados do módulo (`showInForm`), sem conhecer o domínio do módulo.
 * Usada tanto para "Novo" quanto "Editar" — a diferença é só `initialValues`.
 */
export default function RegistryFormModal({
  title,
  fields,
  initialValues,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: RegistryFormModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.accessorKey] = initialValues?.[field.accessorKey] ?? "";
    }
    return initial;
  });
  const [missingFields, setMissingFields] = useState<string[]>([]);

  function handleSubmit() {
    const missing = fields.filter((field) => field.isRequired && !values[field.accessorKey]?.trim());
    if (missing.length > 0) {
      setMissingFields(missing.map((field) => field.label));
      return;
    }
    setMissingFields([]);
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

            {missingFields.length > 0 && (
              <p className="registry-form-modal__error">
                Preencha os campos obrigatórios: {missingFields.join(", ")}.
              </p>
            )}

            <div className="registry-form-modal__fields">
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
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
