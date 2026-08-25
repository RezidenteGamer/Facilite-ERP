import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { useModuleCatalog } from "../features/modules/ModuleCatalogContext";
import { moduleIconFor } from "../features/modules/moduleIcons";

export type OpenWindow = {
  /** Mesmo id do módulo no catálogo quando a janela é um módulo do ERP. */
  id: string;
  label: string;
  path: string;
  /** Ícone mostrado no dock; sem ele o dock cai para a inicial do rótulo. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Imagem do ícone (mesma usada na tela inicial); tem prioridade sobre `icon`. */
  iconImage?: string;
  iconImagePlaceholder?: string;
  iconScale?: number;
};

type OpenWindowsValue = {
  windows: OpenWindow[];
  /** Registra (ou traz de volta) uma janela na lista de abertas. */
  openWindow: (window: OpenWindow) => void;
  /**
   * Atualiza a rota de uma janela já aberta. Existe porque `openWindow`
   * ignora chamadas repetidas para um id que já existe (a identidade da
   * janela — rótulo/ícone — só deveria ser definida uma vez), mas um módulo
   * com lista + formulário (ex.: Pedidos de venda) tem duas sub-rotas para o
   * mesmo id de janela, e o dock precisa navegar para onde o usuário está de
   * fato, não para onde a janela nasceu. Sem efeito se o id não existir.
   */
  updateWindowPath: (id: string, path: string) => void;
  closeWindow: (id: string) => void;
  /**
   * Estado interno da janela, guardado por `windowId` × `slot`. O `slot`
   * existe porque uma janela costuma ter mais de um dono de estado (em
   * Realizar Venda, o rascunho da venda e a etapa do wizard são componentes
   * diferentes) — sem ele, o segundo a gravar apagaria o primeiro. Já
   * `clearWindowState` é por janela inteira, porque o ciclo de vida que
   * importa é o da janela: fechar limpa tudo o que ela guardava.
   */
  getWindowState: <T>(windowId: string, slot: string) => T | undefined;
  setWindowState: <T>(windowId: string, slot: string, state: T) => void;
  clearWindowState: (windowId: string) => void;
};

const OpenWindowsContext = createContext<OpenWindowsValue | null>(null);

/**
 * Lista de janelas/telas abertas — base do uso multitarefa: o usuário abre
 * vários módulos e alterna entre eles pelo WindowDock, sem perder o lugar de
 * onde estava.
 *
 * Guarda duas coisas: a **identidade** da janela (id/rótulo/rota/ícone), que
 * é o que o dock desenha, e o **estado interno** de cada tela. Este segundo
 * existe porque trocar de janela pelo dock é uma navegação de verdade do
 * React Router — a tela anterior desmonta por completo, e sem um lugar fora
 * dela para o rascunho morar, voltar significa recomeçar do zero (era o que
 * acontecia com Realizar Venda: cliente, carrinho e etapa perdidos ao dar
 * uma olhada em Produtos). Não há keep-alive: o DOM realmente é descartado,
 * só os dados sobrevivem.
 *
 * **Por que aqui e não em `sessionStorage`**: o rascunho tem que morrer junto
 * com a janela. O storage do navegador não sabe quando alguém clicou no "X"
 * do dock; este provider sabe, porque é ele quem fecha a janela. Qualquer
 * módulo futuro que precise da mesma garantia usa `getWindowState`/
 * `setWindowState` com o mesmo id que já passa para `openWindow`.
 */
export function OpenWindowsProvider({ children }: { children: ReactNode }) {
  const { byId } = useModuleCatalog();
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  /* `useRef`, não `useState`: gravar o rascunho a cada tecla digitada não
     pode re-renderizar o app inteiro (o provider está acima de todas as
     rotas). Quem lê só precisa do valor uma vez, na montagem — e nessa hora
     o ref já está preenchido. */
  const stateByWindow = useRef(new Map<string, Map<string, unknown>>());

  const openWindow = useCallback(
    (next: OpenWindow) => {
      /* O dock deve mostrar sempre o mesmo ícone da tela inicial. Em vez de
         cada página escolher seu próprio desenho, a chave de ícone vem do
         catálogo (`modules.icon_key`) e o asset vem do registro de ícones do
         código — a mesma dupla que a tela inicial usa. Módulo sem asset
         próprio (o caso de um módulo criado pelo usuário) cai no ícone
         genérico de reserva, nunca em nada. */
      const catalogEntry = byId(next.id);
      const icon = moduleIconFor(catalogEntry?.iconKey ?? next.id);

      setWindows((current) => {
        if (current.some((item) => item.id === next.id)) return current;

        return [
          ...current,
          {
            ...next,
            iconImage: icon.image,
            iconImagePlaceholder: icon.imagePlaceholder,
            iconScale: icon.scale,
            icon: icon.image ? undefined : icon.icon,
          },
        ];
      });
    },
    [byId],
  );

  const updateWindowPath = useCallback((id: string, path: string) => {
    setWindows((current) =>
      current.map((item) => (item.id === id && item.path !== path ? { ...item, path } : item)),
    );
  }, []);

  const clearWindowState = useCallback((windowId: string) => {
    stateByWindow.current.delete(windowId);
  }, []);

  const closeWindow = useCallback(
    (id: string) => {
      /* Fechar a janela precisa jogar fora o que ela guardava, senão abrir o
         módulo de novo ressuscitaria um rascunho que o usuário abandonou de
         propósito. Fica aqui (e não em cada página) porque vale para
         qualquer módulo, e a página que foi fechada já nem está montada para
         se limpar sozinha. */
      clearWindowState(id);
      setWindows((current) => current.filter((item) => item.id !== id));
    },
    [clearWindowState],
  );

  const getWindowState = useCallback(
    <T,>(windowId: string, slot: string) => stateByWindow.current.get(windowId)?.get(slot) as T | undefined,
    [],
  );

  const setWindowState = useCallback(<T,>(windowId: string, slot: string, state: T) => {
    const slots = stateByWindow.current.get(windowId);
    if (slots) {
      slots.set(slot, state);
      return;
    }
    stateByWindow.current.set(windowId, new Map<string, unknown>([[slot, state]]));
  }, []);

  const value = useMemo(
    () => ({
      windows,
      openWindow,
      updateWindowPath,
      closeWindow,
      getWindowState,
      setWindowState,
      clearWindowState,
    }),
    [windows, openWindow, updateWindowPath, closeWindow, getWindowState, setWindowState, clearWindowState],
  );

  return <OpenWindowsContext.Provider value={value}>{children}</OpenWindowsContext.Provider>;
}

export function useOpenWindows() {
  const context = useContext(OpenWindowsContext);
  if (!context) {
    throw new Error("useOpenWindows precisa estar dentro de <OpenWindowsProvider>");
  }
  return context;
}
