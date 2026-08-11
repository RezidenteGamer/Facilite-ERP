import { useEffect, useRef } from "react";
import SupportMenu from "./SupportMenu";
import SupportTab from "./SupportTab";

type SupportWidgetProps = {
  open: boolean;
  closing: boolean;
  onOpen: () => void;
  onRequestClose: () => void;
};

/**
 * Junta a aba "Suporte" com o popup de ações que abre ao clicar nela.
 * O estado (open/closing) vem de fora — ver useSupportMenu — para que o
 * link "Suporte" do menu superior possa abrir o mesmo popup que esta aba.
 */
export default function SupportWidget({ open, closing, onOpen, onRequestClose }: SupportWidgetProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || closing) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      onRequestClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onRequestClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closing, onRequestClose]);

  return (
    <>
      {!open && <SupportTab buttonRef={triggerRef} onClick={onOpen} />}
      {open && <SupportMenu panelRef={menuRef} onClose={onRequestClose} closing={closing} />}
    </>
  );
}
