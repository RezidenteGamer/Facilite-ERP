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
import { HOME_MODULES } from "../features/home/modules";

export type OpenWindow = {
  /** Mesmo id do módulo em HOME_MODULES quando a janela é um módulo do ERP. */
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
  const [windows, setWindows] = useState<OpenWindow[]>([]);

  const openWindow = useCallback((next: OpenWindow) => {
    setWindows((current) => {
      if (current.some((item) => item.id === next.id)) return current;

      /* O dock deve mostrar sempre o mesmo ícone da tela inicial — em vez
         de cada página escolher seu próprio desenho, buscamos aqui pela
         imagem oficial do módulo (HOME_MODULES), com o `icon` recebido
         como fallback só para itens que ainda não têm iconImage. */
      const module = HOME_MODULES.find((item) => item.id === next.id);
      const withHomeIcon: OpenWindow = module
        ? {
            ...next,
            iconImage: module.iconImage,
            iconImagePlaceholder: module.iconImagePlaceholder,
            iconScale: module.iconScale,
            icon: module.iconImage ? undefined : module.icon,
          }
        : next;

      return [...current, withHomeIcon];
    });
  }, []);

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
