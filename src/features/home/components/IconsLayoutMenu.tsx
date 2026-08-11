import { useEffect, useRef } from "react";
import type { IconsArrangement } from "../useIconsArrangement";
import "./IconsLayoutMenu.css";

type IconsLayoutMenuProps = {
  position: { x: number; y: number };
  current: IconsArrangement;
  onSelect: (value: IconsArrangement) => void;
  onClose: () => void;
};

const OPTIONS: { value: IconsArrangement; label: string }[] = [
  { value: "grid", label: "Layout atual" },
  { value: "sidebar", label: "Lateral" },
];

/** Menu de clique direito para escolher a disposição dos ícones da home. */
export default function IconsLayoutMenu({ position, current, onSelect, onClose }: IconsLayoutMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    // "pointerdown" já cobre um novo clique direito em outro lugar (dispara
    // antes do "contextmenu" do navegador), então um right-click fora fecha
    // este menu a tempo do handler de abrir o próximo já rodar em seguida.
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="icons-layout-menu"
      style={{ top: position.y, left: position.x }}
      role="menu"
      aria-label="Layout dos ícones"
    >
      <p className="icons-layout-menu__title">Layout dos ícones</p>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={current === option.value}
          className="icons-layout-menu__item"
          onClick={() => {
            onSelect(option.value);
            onClose();
          }}
        >
          <span className="icons-layout-menu__check" aria-hidden="true">
            {current === option.value ? "✓" : ""}
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );
}
