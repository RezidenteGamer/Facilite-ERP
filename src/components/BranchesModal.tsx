import { useEffect } from "react";
import { ArrowRightIcon, CloseIcon } from "./icons";
import { BRANCHES } from "./branches";
import "./BranchesModal.css";

type BranchesModalProps = {
  onClose: () => void;
};

/** Quantas linhas o quadro mostra mesmo com poucas filiais cadastradas. */
const MIN_VISIBLE_ROWS = 6;

/** Modal central de filiais — abre a partir do "Filiais" do menu superior. */
export default function BranchesModal({ onClose }: BranchesModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const placeholderCount = Math.max(0, MIN_VISIBLE_ROWS - BRANCHES.length);

  return (
    <div className="branches-modal__overlay" onClick={onClose}>
      <div
        className="branches-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Filiais"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="branches-modal__close" type="button" aria-label="Fechar" onClick={onClose}>
          <CloseIcon />
        </button>

        <h2 className="branches-modal__title">Filiais</h2>

        <div className="branches-modal__header">
          <span>Código</span>
          <span>Nome</span>
          <span>CNPJ</span>
          <span aria-hidden="true" />
        </div>

        <div className="branches-modal__body">
          {BRANCHES.map((branch) => (
            <div className="branches-modal__row" key={branch.code}>
              <span className="branches-modal__code">{branch.code}</span>
              <span className="branches-modal__name">{branch.name}</span>
              <span className="branches-modal__cnpj">{branch.cnpj}</span>
              <button
                className="branches-modal__select"
                type="button"
                aria-label={`Selecionar filial ${branch.name}`}
                onClick={onClose}
              >
                <ArrowRightIcon />
              </button>
            </div>
          ))}

          {Array.from({ length: placeholderCount }, (_, index) => (
            <div className="branches-modal__row branches-modal__row--empty" key={`vazio-${index}`} aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
}
