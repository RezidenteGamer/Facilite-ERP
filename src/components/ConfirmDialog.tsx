import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import "./ConfirmDialog.css";

type ConfirmDialogProps = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Diálogo de confirmação genérico — mesma moldura visual usada nos outros
 * popups. O foco (trap, devolução ao gatilho, Escape, clique fora) é
 * gerenciado pelo Radix Dialog; este componente só estiliza.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Sim",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirm-dialog__overlay">
          <Dialog.Content
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            {...(message ? {} : { "aria-describedby": undefined })}
            onOpenAutoFocus={(event) => {
              // Confirmar (não o diálogo em si) é o alvo padrão do Enter,
              // como já era antes da migração para o Radix.
              event.preventDefault();
              confirmRef.current?.focus();
            }}
          >
            <Dialog.Title className="confirm-dialog__title" asChild>
              <p>{title}</p>
            </Dialog.Title>
            {message && <Dialog.Description className="confirm-dialog__message">{message}</Dialog.Description>}

            <div className="confirm-dialog__actions">
              <button className="confirm-dialog__btn confirm-dialog__btn--cancel" type="button" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                className="confirm-dialog__btn confirm-dialog__btn--confirm"
                type="button"
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
