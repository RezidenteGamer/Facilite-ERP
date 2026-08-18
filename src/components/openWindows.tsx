import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
  closeWindow: (id: string) => void;
};

const OpenWindowsContext = createContext<OpenWindowsValue | null>(null);

/**
 * Lista de janelas/telas abertas — base do uso multitarefa: o usuário abre
 * vários módulos e alterna entre eles pelo WindowSwitcher, sem perder o
 * lugar de onde estava. Por enquanto guarda só a identidade da janela
 * (id/rótulo/rota); estado interno de cada tela entra aqui quando existir.
 */
export function OpenWindowsProvider({ children }: { children: ReactNode }) {
  const { byId } = useModuleCatalog();
  const [windows, setWindows] = useState<OpenWindow[]>([]);

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

  const closeWindow = useCallback((id: string) => {
    setWindows((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(
    () => ({ windows, openWindow, closeWindow }),
    [windows, openWindow, closeWindow],
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
