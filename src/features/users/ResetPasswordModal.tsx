import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";

type ResetPasswordModalProps = {
  userName: string;
  onSubmit: (newPassword: string) => void;
  onCancel: () => void;
};

/** Modal para um administrador (`can_manage_users`) resetar a senha de outro usuário. */
export default function ResetPasswordModal({ userName, onSubmit, onCancel }: ResetPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit() {
    if (password.trim().length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    setError("");
    onSubmit(password);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Resetar senha de {userName}</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}

            <div className="registry-form-modal__fields">
              <FormField
                id="reset-password-new"
                label="Nova senha"
                type="password"
                value={password}
                onChange={setPassword}
              />
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
                Resetar senha
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
