import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import BackTab from "./BackTab";
import BranchesModal from "./BranchesModal";
import SupportWidget from "./SupportWidget";
import WindowDock from "./WindowDock";
import { SearchIcon } from "./icons";
import { useSupportMenu } from "./useSupportMenu";
import "./AppShell.css";

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
  children,
}: AppShellProps) {
  const supportMenu = useSupportMenu();
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const headerRef = useRef<HTMLElement>(null);
  const expandedHeightRef = useRef(0);
  const collapsedHeightRef = useRef(0);

  // Mede as duas alturas do cabeçalho para saber quanto a página encolhe
  // quando ele recolhe — é esse valor que decide se recolher é seguro.
  useLayoutEffect(() => {
    const height = headerRef.current?.offsetHeight ?? 0;
    if (!height) return;
    if (scrolled) collapsedHeightRef.current = height;
    else expandedHeightRef.current = height;
  }, [scrolled]);

  useEffect(() => {
    // A faixa encolher muda a altura do cabeçalho, o que empurra o conteúdo
    // e pode mexer no scroll no meio da transição. Defesas contra isso:
    // 1) limiares diferentes para recolher/expandir (histerese) — sem isso,
    //    um scroll de ida e volta bem no limiar fica ligando/desligando a
    //    classe repetidas vezes e a animação nunca termina de vez;
    // 2) só reagir uma vez por frame (requestAnimationFrame) em vez de a
    //    cada evento de scroll, que dispara várias vezes por frame;
    // 3) não recolher quando a página mal rola: recolher encurtaria a página
    //    a ponto de zerar o próprio scroll, o que reexpandiria o cabeçalho e
    //    voltaria a permitir o scroll — o loop infinito que aparecia quando
    //    a rolagem ia só até a metade.
    let ticking = false;

    function updateScrolled() {
      ticking = false;
      const y = window.scrollY;

      setScrolled((wasScrolled) => {
        // Enquanto o cabeçalho nunca recolheu não dá para medir o quanto ele
        // encolhe, então estimamos por cima (~55% da altura aberta). Estimar
        // baixo demais aqui é justamente o que deixava passar o primeiro
        // recolhimento indevido e causava o pisca-pisca.
        const expandida = expandedHeightRef.current;
        const recolhida = collapsedHeightRef.current;
        const delta = recolhida > 0 ? Math.max(0, expandida - recolhida) : Math.round(expandida * 0.55);
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        // Estimativa do quanto a página rolaria com o cabeçalho aberto —
        // grandeza estável, que não muda conforme ele abre e fecha.
        const maxScrollExpandido = maxScroll + (wasScrolled ? delta : 0);

        if (maxScrollExpandido < delta + 80) return false;

        return wasScrolled ? y > 12 : y > 56;
      });
    }

    function handleScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateScrolled);
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
    <div className={`app-shell${fillViewport ? " app-shell--fill" : ""}`}>
      <header ref={headerRef} className={`app-header${scrolled ? " app-header--compact" : ""}`}>
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

      {branchesOpen && <BranchesModal onClose={() => setBranchesOpen(false)} />}

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
