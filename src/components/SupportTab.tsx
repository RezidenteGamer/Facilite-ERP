import type { Ref } from "react";
import "./FloatingTabs.css";

type SupportTabProps = {
  expanded?: boolean;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** Aba azul encostada na borda inferior direita — abre o menu de suporte. */
export default function SupportTab({ expanded, onClick, buttonRef }: SupportTabProps) {
  return (
    <button
      ref={buttonRef}
      className="floating-tab floating-tab--support"
      type="button"
      aria-haspopup="true"
      aria-expanded={expanded}
      onClick={onClick}
    >
      Suporte
    </button>
  );
}
