import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import FadeImage from "./FadeImage";
import { CloseIcon } from "./icons";
import { useOpenWindows } from "./openWindows";
import "./WindowDock.css";

const MAX_WINDOWS_PER_PAGE = 10;
/* Espaço reservado nas pontas da tela para as abas flutuantes de Voltar e
   Suporte — sem isto o dock cresceria por baixo delas em vez de paginar. */
const HORIZONTAL_RESERVED_SPACE = 220;
const SLOT_WIDTH_DESKTOP = 60; // 52px de ícone + 8px de gap (ver WindowDock.css)
const SLOT_WIDTH_MOBILE = 50; // 44px de ícone + 6px de gap, breakpoint em 640px

function isEditableTarget(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function computeItemsPerPage(): number {
  if (typeof window === "undefined") return MAX_WINDOWS_PER_PAGE;
  const slotWidth = window.innerWidth <= 640 ? SLOT_WIDTH_MOBILE : SLOT_WIDTH_DESKTOP;
  const available = window.innerWidth - HORIZONTAL_RESERVED_SPACE;
  const fitByWidth = Math.floor(available / slotWidth);
  return Math.max(1, Math.min(MAX_WINDOWS_PER_PAGE, fitByWidth));
}

/**
 * Dock das janelas abertas, no estilo do macOS: ícones lado a lado numa barra
 * de vidro, que ampliam e mostram o nome ao passar o mouse. Substitui a antiga
 * aba "Janelas abertas" e continua sendo o atalho do uso multitarefa.
 * Fica escondido enquanto nada estiver aberto.
 *
 * Paginado quando não cabe: mais de 10 janelas, ou a tela estreita demais
 * para 10 ícones legíveis. As teclas 1-9 e 0 pulam para a janela naquela
 * posição *da página visível* — nunca quando o foco está num campo de
 * digitação, senão roubaria número de quem está digitando preço/quantidade.
 */
export default function WindowDock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { windows, closeWindow, dockPage: page, setDockPage: setPage } = useOpenWindows();

  const [itemsPerPage, setItemsPerPage] = useState(computeItemsPerPage);
  const previousCount = useRef(windows.length);

  useEffect(() => {
    function handleResize() {
      setItemsPerPage(computeItemsPerPage());
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const totalPages = Math.max(1, Math.ceil(windows.length / itemsPerPage));

  useEffect(() => {
    /* Uma janela nova sempre entra no fim da lista — pula para a última
       página para quem acabou de abrir enxergar o que abriu. Fechar uma
       janela (ou a página encolher com a tela) pode deixar a página atual
       além do fim; volta para a última válida. */
    if (windows.length > previousCount.current) {
      setPage(totalPages - 1);
    } else if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
    previousCount.current = windows.length;
  }, [windows.length, totalPages, page]);

  const pageStart = page * itemsPerPage;
  const visibleWindows = useMemo(
    () => windows.slice(pageStart, pageStart + itemsPerPage),
    [windows, pageStart, itemsPerPage],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!/^[0-9]$/.test(event.key)) return;
      if (isEditableTarget(document.activeElement)) return;

      const index = event.key === "0" ? 9 : Number(event.key) - 1;
      const target = visibleWindows[index];
      if (!target) return;

      event.preventDefault();
      navigate(target.path);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visibleWindows, navigate]);

  if (windows.length === 0) return null;

  return (
    <nav className="window-dock" aria-label="Janelas abertas">
      {totalPages > 1 && (
        <button
          type="button"
          className="window-dock__page-nav"
          aria-label="Página anterior de janelas"
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          ‹
        </button>
      )}

      <ul className="window-dock__list">
        {visibleWindows.map((window, index) => {
          const Icon = window.icon;
          const ativa = location.pathname === window.path;
          const shortcutDigit = index < 9 ? String(index + 1) : index === 9 ? "0" : null;

          return (
            <li key={window.id} className="window-dock__slot">
              <span className="window-dock__label" aria-hidden="true">
                {window.label}
              </span>

              {/* Número e "x" moram dentro do mesmo wrap que recebe o
                  scale/translateY do hover — presos ao ícone, não ao slot
                  parado, senão ficam para trás quando o quadrado cresce. */}
              <div className="window-dock__icon-wrap">
                {shortcutDigit && (
                  <span className="window-dock__shortcut" aria-hidden="true">
                    {shortcutDigit}
                  </span>
                )}

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
              </div>

              <span className={`window-dock__dot${ativa ? " window-dock__dot--on" : ""}`} aria-hidden="true" />
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <button
          type="button"
          className="window-dock__page-nav"
          aria-label="Próxima página de janelas"
          disabled={page === totalPages - 1}
          onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
        >
          ›
        </button>
      )}
    </nav>
  );
}
