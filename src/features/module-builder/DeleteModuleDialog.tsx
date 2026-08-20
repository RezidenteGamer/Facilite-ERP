import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import "../registry-engine/RegistryFormModal.css";
import type { BuilderModule } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

/**
 * Confirmação de exclusão de um módulo inteiro.
 *
 * Não é o `ConfirmDialog` genérico de "excluir registro" de propósito: aquele
 * apaga uma linha, este apaga o módulo, **todos os registros dele**, os
 * campos, e as permissões de todos os papéis. Por isso lista o que vai embora
 * e exige digitar o nome do módulo — o atrito é a funcionalidade.
 */
export default function DeleteModuleDialog({
  module,
  recordCount,
  onConfirm,
  onCancel,
}: {
  module: BuilderModule;
  /** Quantos registros o módulo tem hoje; `null` = ainda contando. */
  recordCount: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLocaleLowerCase() === module.label.toLocaleLowerCase();

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content
            className="registry-form-modal module-builder__danger-modal"
            role="alertdialog"
            aria-describedby={undefined}
          >
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Excluir o módulo “{module.label}”?</p>
            </Dialog.Title>

            <p className="module-builder__danger-text">
              Isto apaga, de uma vez e sem desfazer:
            </p>
            <ul className="module-builder__danger-list">
              <li>
                {recordCount === null
                  ? "os registros do módulo"
                  : `${recordCount} ${recordCount === 1 ? "registro" : "registros"} em module_records`}
              </li>
              <li>os campos do módulo (module_fields)</li>
              <li>as permissões de todos os papéis sobre ele (role_permissions)</li>
              <li>
                a própria linha do catálogo — a rota <code>{module.path}</code> e o tile deixam de
                existir
              </li>
            </ul>

            <div className="registry-form-modal__fields">
              <FormField
                id="delete-module-confirm"
                label={`Digite “${module.label}” para confirmar`}
                value={typed}
                onChange={setTyped}
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
                className="module-builder__btn module-builder__btn--danger"
                type="button"
                disabled={!matches}
                onClick={onConfirm}
              >
                Excluir o módulo
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
