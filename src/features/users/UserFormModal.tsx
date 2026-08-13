import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type { Role } from "./users";
import "../registry-engine/RegistryFormModal.css";

export type UserFormValues = {
  email: string;
  password: string;
  name: string;
  document: string;
  operatorCode: string;
  roleId: string;
};

type UserFormModalProps = {
  mode: "create" | "edit";
  title: string;
  roles: Role[];
  initialValues?: Partial<UserFormValues>;
  onSubmit: (values: UserFormValues) => void;
  onCancel: () => void;
};

/** Modal de criação/edição de usuário — email/senha só aparecem ao criar. */
export default function UserFormModal({
  mode,
  title,
  roles,
  initialValues,
  onSubmit,
  onCancel,
}: UserFormModalProps) {
  const [values, setValues] = useState<UserFormValues>({
    email: initialValues?.email ?? "",
    password: "",
    name: initialValues?.name ?? "",
    document: initialValues?.document ?? "",
    operatorCode: initialValues?.operatorCode ?? "",
    roleId: initialValues?.roleId ?? roles[0]?.id ?? "",
  });
  const [missingFields, setMissingFields] = useState<string[]>([]);

  function set<K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit() {
    const missing: string[] = [];
    if (mode === "create" && !values.email.trim()) missing.push("Email");
    if (mode === "create" && !values.password.trim()) missing.push("Senha");
    if (!values.name.trim()) missing.push("Nome");
    if (missing.length > 0) {
      setMissingFields(missing);
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
              {mode === "create" && (
                <>
                  <FormField
                    id="user-form-email"
                    label="Email *"
                    type="email"
                    value={values.email}
                    onChange={(value) => set("email", value)}
                  />
                  <FormField
                    id="user-form-password"
                    label="Senha *"
                    type="password"
                    value={values.password}
                    onChange={(value) => set("password", value)}
                  />
                </>
              )}

              <FormField
                id="user-form-name"
                label="Nome *"
                value={values.name}
                onChange={(value) => set("name", value)}
              />
              <FormField
                id="user-form-document"
                label="CPF/CNPJ"
                value={values.document}
                onChange={(value) => set("document", value)}
              />
              <FormField
                id="user-form-operator-code"
                label="Código de operador"
                value={values.operatorCode}
                onChange={(value) => set("operatorCode", value)}
              />

              <div className="form-field">
                <label className="form-field__label" htmlFor="user-form-role">
                  Papel de acesso
                </label>
                <div className="form-field__control">
                  <select
                    id="user-form-role"
                    className="form-field__input"
                    value={values.roleId}
                    onChange={(event) => set("roleId", event.target.value)}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>
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
                Salvar
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
