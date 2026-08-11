import type { Ref } from "react";
import "./SupportMenu.css";

type SupportMenuProps = {
  panelRef?: Ref<HTMLDivElement>;
  onClose?: () => void;
  /** Toca a animação de "arrastado para baixo" antes do componente sumir. */
  closing?: boolean;
};

const ACTIONS = [
  { id: "atendente-virtual", label: "Atendente virtual" },
  { id: "abrir-ticket", label: "Abrir ticket online" },
  { id: "whatsapp", label: "Adicionar WhatsApp" },
];

/** Popup que abre a partir da aba "Suporte" — mesmas ações da referência enviada. */
export default function SupportMenu({ panelRef, onClose, closing }: SupportMenuProps) {
  return (
    <div
      ref={panelRef}
      className={`support-menu${closing ? " support-menu--closing" : ""}`}
      role="menu"
      aria-label="Suporte"
    >
      <button className="support-menu__close" type="button" aria-label="Fechar" onClick={onClose}>
        ×
      </button>

      <p className="support-menu__title">Suporte</p>

      <div className="support-menu__actions">
        {ACTIONS.map((action) => (
          <a
            key={action.id}
            className="support-menu__btn"
            href="#"
            data-action={action.id}
            role="menuitem"
          >
            {action.label}
          </a>
        ))}
      </div>

      <p className="support-menu__phone">Telefone: (46) 99912964-55</p>
    </div>
  );
}
