import { useEffect } from "react";
import "./ConfirmDialog.css";

type ConfirmDialogProps = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Diálogo de confirmação genérico — mesma moldura visual usada nos outros popups. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Sim",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-dialog__overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="confirm-dialog__title">{title}</p>
        {message && <p className="confirm-dialog__message">{message}</p>}

        <div className="confirm-dialog__actions">
          <button className="confirm-dialog__btn confirm-dialog__btn--cancel" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            type="button"
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
