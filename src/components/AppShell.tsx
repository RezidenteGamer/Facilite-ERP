import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import BackTab from "./BackTab";
import SupportWidget from "./SupportWidget";
import WindowDock from "./WindowDock";
import { MoonIcon, SearchIcon, SunIcon } from "./icons";
import { useSupportMenu } from "./useSupportMenu";
import { useTheme } from "../theme/ThemeProvider";
import "./AppShell.css";

// Só é montado quando o usuário abre o popup de filiais — carregar sob
// demanda evita colocar @radix-ui/react-dialog no bundle de toda tela que
// usa AppShell (ou seja, quase todas).
const BranchesModal = lazy(() => import("./BranchesModal"));

export type HeaderNavItem = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  active?: boolean;
  /** Ignorado nos itens "suporte" e "filiais" — esses sempre abrem seu próprio popup. */
  onClick?: () => void;
};

type AppShellProps = {
  navItems: HeaderNavItem[];
  /** Texto da faixa fina abaixo do cabeçalho (nome da filial, título da tela, etc.). */
  secondaryText: string;
  /** "Comércio", etc. — algumas telas mostram isso ao lado da logo, outras não. */
  moduleLabel?: string;
  onContentContextMenu?: (event: MouseEvent) => void;
  /** Sobrepõe o "voltar no histórico" padrão da aba Voltar (ex.: confirmar saída na home). */
  onBack?: () => void;
  /**
   * Fundo do miolo: "light" (padrão) é o da tela inicial, com ícones amarelos
   * sobre branco; "blue" é o dos módulos internos, onde textos e campos
   * brancos precisam de fundo azul para aparecer.
   */
  contentTone?: "light" | "blue";
  /**
   * Trava a tela na altura da janela: o miolo nunca rola a página, quem rola
   * são as áreas internas (ex.: a tabela de clientes). Mantém as colunas
   * laterais sempre à vista — e, de quebra, a faixa azul nunca precisa
   * recolher nessas telas.
   */
  fillViewport?: boolean;
  reserveHeaderScroll?: boolean;
  children: ReactNode;
};

/**
 * Moldura repetida na maioria das telas: faixa azul (logo, navegação, busca,
 * linha secundária) + abas flutuantes (Voltar, Suporte). Cada tela só passa
 * o que muda — itens de navegação, texto da linha secundária, conteúdo —
 * em vez de reconstruir esses elementos toda vez. "Suporte" e "Filiais" já
 * vêm prontos: qualquer tela que inclua esses ids no navItems ganha o popup
 * de graça, sem reimplementar nada.
 */
export default function AppShell({
  navItems,
  secondaryText,
  moduleLabel,
  onContentContextMenu,
  onBack,
  contentTone = "light",
  fillViewport = false,
  reserveHeaderScroll = false,
  children,
}: AppShellProps) {
  const supportMenu = useSupportMenu();
  const { theme, toggleTheme } = useTheme();
  const [branchesOpen, setBranchesOpen] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  // Altura do cabeçalho totalmente aberto — recalibrada sempre que o topo da
  // página é visitado (ver updateHeader), então acompanha sozinha qualquer
  // mudança de conteúdo/responsivo sem precisar remedir manualmente.
  const expandedHeightRef = useRef(0);

  useEffect(() => {
    // A faixa encolher muda a própria altura do cabeçalho — e como ele fica
    // no fluxo normal (sticky), isso encurta a página inteira. Se a página
    // for curta o bastante, encolher tira o scroll de baixo dos pés: o
    // navegador prende o scroll no novo limite (menor), o que cai o
    // progresso, reexpande o cabeçalho, alonga a página de novo, e o ciclo
    // recomeça a cada frame — o tremor visível ao rolar telas curtas (ex.:
    // Realizar venda). A proteção mora aqui dentro, junto da própria
    // animação, em vez de em um estado à parte que alguém possa desconectar
    // sem perceber: só encolhe quando sobra bastante espaço de rolagem além
    // da distância de recolhimento (COLLAPSE_DISTANCE + SAFETY_MARGIN),
    // medido sempre como se o cabeçalho estivesse no tamanho cheio — valor
    // que não muda conforme ele abre e fecha, então não tem como esse
    // cálculo oscilar.
    const COLLAPSE_DISTANCE = 110;
    // Bem maior que o quanto o cabeçalho de fato encolhe hoje (~90-120px),
    // de propósito: um ajuste futuro no tamanho do cabeçalho não deveria
    // conseguir reabrir essa brecha sem alguém mexer aqui também.
    const SAFETY_MARGIN = 220;

    let ticking = false;

    function updateHeader() {
      ticking = false;
      const header = headerRef.current;
      if (!header) return;

      const scrollY = window.scrollY;

      // No topo o cabeçalho está sempre no tamanho cheio — aproveita pra
      // recalibrar a altura "expandida" de referência.
      if (scrollY < 1) {
        expandedHeightRef.current = header.offsetHeight;
      }
      const expandedHeight = expandedHeightRef.current || header.offsetHeight;

      // Corrige o scrollHeight atual (que já pode refletir um cabeçalho
      // parcialmente encolhido) para "como se ele estivesse aberto".
      const maxScrollAtFullHeight =
        document.documentElement.scrollHeight - header.offsetHeight + expandedHeight - window.innerHeight;
      const hasRoomToCollapse = maxScrollAtFullHeight >= COLLAPSE_DISTANCE + SAFETY_MARGIN;

      const progress = hasRoomToCollapse ? Math.min(Math.max(scrollY / COLLAPSE_DISTANCE, 0), 1) : 0;
      const between = (from: number, to: number) => from + (to - from) * progress;
      const style = header.style;

      style.setProperty("--header-padding-top", `${between(18, 10)}px`);
      style.setProperty("--brand-size", `${between(38, 24)}px`);
      style.setProperty("--brand-padding-bottom", `${between(6, 0)}px`);
      style.setProperty("--brand-swoosh-opacity", `${1 - progress}`);
      style.setProperty("--brand-module-width", `${between(90, 0)}px`);
      style.setProperty("--brand-module-opacity", `${0.9 * (1 - progress)}`);
      style.setProperty("--nav-padding-top", `${between(12, 0)}px`);
      style.setProperty("--nav-gap", `${between(26, 16)}px`);
      style.setProperty("--nav-font-size", `${between(16, 13)}px`);
      style.setProperty("--nav-icon-size", `${between(20, 18)}px`);
      style.setProperty("--nav-item-gap", `${between(6, 0)}px`);
      style.setProperty("--nav-label-width", `${between(132, 0)}px`);
      style.setProperty("--nav-label-opacity", `${1 - progress}`);
      style.setProperty("--search-label-height", `${between(17, 0)}px`);
      style.setProperty("--search-label-opacity", `${1 - progress}`);
      style.setProperty("--search-placeholder-opacity", `${1 - progress}`);
      style.setProperty("--search-gap", `${between(6, 0)}px`);
      style.setProperty("--search-width", `${between(340, 240)}px`);
      style.setProperty("--search-padding-y", `${between(10, 6)}px`);
      style.setProperty("--search-padding-x", `${between(18, 16)}px`);
      style.setProperty("--branch-max-height", `${between(60, 0)}px`);
      style.setProperty("--branch-opacity", `${1 - progress}`);
      style.setProperty("--branch-margin-top", `${between(14, 0)}px`);
      style.setProperty("--branch-padding-top", `${between(8, 0)}px`);
      style.setProperty("--branch-padding-bottom", `${between(14, 0)}px`);
    }

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateHeader);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  function handleNavClick(event: MouseEvent, item: HeaderNavItem) {
    event.preventDefault();
    if (item.id === "suporte") {
      supportMenu.openMenu();
      return;
    }
    if (item.id === "filiais") {
      setBranchesOpen(true);
      return;
    }
    item.onClick?.();
  }

  return (
    <div
      className={`app-shell${fillViewport ? " app-shell--fill" : ""}${
        reserveHeaderScroll ? " app-shell--scroll-reserve" : ""
      }`}
    >
      <header ref={headerRef} className="app-header">
        <div className="app-header__row">
          <div className="app-brand">
            <h1 className="app-brand__word">
              <span className="app-brand__ink">Faci</span>
              <span className="app-brand__accent">lit</span>
              <span className="app-brand__ink">e</span>
            </h1>
            <svg className="app-brand__swoosh" viewBox="0 0 150 42" fill="none" aria-hidden="true">
              <path
                d="M5 13C13 30 45 38 84 33c23-3 41-13 52-27"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <path
                d="M120 11 136 6 135 23"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {moduleLabel && <span className="app-brand__module">{moduleLabel}</span>}
          </div>

          <nav className="app-nav" aria-label="Navegação principal">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  key={item.id}
                  className={`app-nav__item${item.active ? " app-nav__item--active" : ""}`}
                  href="#"
                  data-action={`nav-${item.id}`}
                  /* Em telas pequenas o rótulo some e sobra só o ícone — o
                     title garante que o nome continua acessível (tooltip
                     no hover, leitor de tela). */
                  title={item.label}
                  onClick={(event) => handleNavClick(event, item)}
                >
                  <Icon />
                  <span className="app-nav__item-label">{item.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="app-search">
            <span className="app-search__label">O que você busca?</span>
            <div className="app-search__box">
              <SearchIcon />
              <input type="search" placeholder="Digite aqui o que você busca!" />
            </div>
          </div>

          <button
            className="app-theme-toggle"
            type="button"
            aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        <p className="app-header__branch">{secondaryText}</p>
      </header>

      <main
        className={`app-content${contentTone === "blue" ? " app-content--blue" : ""}${
          fillViewport ? " app-content--fit" : ""
        }`}
        onContextMenu={onContentContextMenu}
      >
        {children}
      </main>

      {branchesOpen && (
        <Suspense fallback={null}>
          <BranchesModal onClose={() => setBranchesOpen(false)} />
        </Suspense>
      )}

      <BackTab onClick={onBack} />
      <WindowDock />
      <SupportWidget
        open={supportMenu.open}
        closing={supportMenu.closing}
        onOpen={supportMenu.openMenu}
        onRequestClose={supportMenu.requestClose}
      />
    </div>
  );
}
