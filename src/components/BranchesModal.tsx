import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightIcon, CloseIcon } from "./icons";
import { BRANCHES } from "./branches";
import "./BranchesModal.css";

type BranchesModalProps = {
  onClose: () => void;
};

/** Quantas linhas o quadro mostra mesmo com poucas filiais cadastradas. */
const MIN_VISIBLE_ROWS = 6;

/**
 * Modal central de filiais — abre a partir do "Filiais" do menu superior.
 * Foco (trap, devolução ao gatilho, Escape, clique fora) é gerenciado pelo
 * Radix Dialog; este componente só estiliza.
 */
export default function BranchesModal({ onClose }: BranchesModalProps) {
  const placeholderCount = Math.max(0, MIN_VISIBLE_ROWS - BRANCHES.length);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="branches-modal__overlay">
          <Dialog.Content className="branches-modal" aria-describedby={undefined} aria-modal="true">
            <Dialog.Close asChild>
              <button className="branches-modal__close" type="button" aria-label="Fechar">
                <CloseIcon />
              </button>
            </Dialog.Close>

            <Dialog.Title className="branches-modal__title" asChild>
              <h2>Filiais</h2>
            </Dialog.Title>

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
                <div
                  className="branches-modal__row branches-modal__row--empty"
                  key={`vazio-${index}`}
                  aria-hidden="true"
                />
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
