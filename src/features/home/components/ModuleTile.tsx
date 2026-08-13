import type { DraggableAttributes } from "@dnd-kit/core";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import type { CSSProperties } from "react";
import FadeImage from "../../../components/FadeImage";
import type { HomeModule } from "../modules";
import "./ModuleTile.css";

type ModuleTileProps = {
  module: HomeModule;
  onSelect?: (id: string) => void;
  /** Estilo aplicado quando renderizado dentro do DragOverlay (arrastando). */
  overlay?: boolean;
  /** attributes/listeners do dnd-kit — repassados pelo wrapper arrastável. */
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
};

/**
 * Ícone amarelo + rótulo de um módulo do ERP.
 * Compartilhado por todos os layouts (Original, Foco, Desktop) — cada um
 * decide só o arranjo (grade, lista, etc.), não como o item em si é desenhado.
 */
export default function ModuleTile({
  module,
  onSelect,
  overlay,
  dragAttributes,
  dragListeners,
}: ModuleTileProps) {
  const Icon = module.icon;

  return (
    <button
      className={`module-tile${overlay ? " module-tile--overlay" : ""}`}
      type="button"
      onClick={() => onSelect?.(module.id)}
      {...dragAttributes}
      {...dragListeners}
    >
      <span className="module-tile__icon">
        {module.iconImage ? (
          <FadeImage
            src={module.iconImage}
            placeholder={module.iconImagePlaceholder}
            alt=""
            className="module-tile__icon-image"
            style={
              module.iconScale
                ? ({ "--module-icon-scale": module.iconScale } as CSSProperties)
                : undefined
            }
          />
        ) : (
          <Icon />
        )}
        {module.badge === "add" && (
          <span className="module-tile__badge" aria-hidden="true">
            +
          </span>
        )}
      </span>
      <span className="module-tile__label">{module.label}</span>
    </button>
  );
}
