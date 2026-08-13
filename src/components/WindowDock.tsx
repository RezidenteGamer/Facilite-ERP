import type { CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import FadeImage from "./FadeImage";
import { CloseIcon } from "./icons";
import { useOpenWindows } from "./openWindows";
import "./WindowDock.css";

/**
 * Dock das janelas abertas, no estilo do macOS: ícones lado a lado numa barra
 * de vidro, que ampliam e mostram o nome ao passar o mouse. Substitui a antiga
 * aba "Janelas abertas" e continua sendo o atalho do uso multitarefa.
 * Fica escondido enquanto nada estiver aberto.
 */
export default function WindowDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { windows, closeWindow } = useOpenWindows();

  if (windows.length === 0) return null;

  return (
    <nav className="window-dock" aria-label="Janelas abertas">
      <ul className="window-dock__list">
        {windows.map((window) => {
          const Icon = window.icon;
          const ativa = location.pathname === window.path;

          return (
            <li key={window.id} className="window-dock__slot">
              <span className="window-dock__label" aria-hidden="true">
                {window.label}
              </span>

              <button
                className="window-dock__item"
                type="button"
                aria-label={window.label}
                aria-current={ativa ? "page" : undefined}
                onClick={() => navigate(window.path)}
              >
                {window.iconImage ? (
                  <FadeImage
                    src={window.iconImage}
                    placeholder={window.iconImagePlaceholder}
                    alt=""
                    className="window-dock__icon-image"
                    style={
                      window.iconScale
                        ? ({ "--module-icon-scale": window.iconScale } as CSSProperties)
                        : undefined
                    }
                  />
                ) : Icon ? (
                  <Icon />
                ) : (
                  <span className="window-dock__initial">{window.label[0]}</span>
                )}
              </button>

              <button
                className="window-dock__close"
                type="button"
                aria-label={`Fechar ${window.label}`}
                onClick={() => {
                  closeWindow(window.id);
                  /* Fechar a janela que está na tela não pode só sumir do
                     dock — sem isto o conteúdo continua ali, e para quem
                     clicou parece que nada aconteceu. */
                  if (ativa) navigate("/inicio");
                }}
              >
                <CloseIcon />
              </button>

              <span className={`window-dock__dot${ativa ? " window-dock__dot--on" : ""}`} aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
