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

export type OpenWindow = {
  /** Mesmo id do módulo em HOME_MODULES quando a janela é um módulo do ERP. */
  id: string;
  label: string;
  path: string;
  /** Ícone mostrado no dock; sem ele o dock cai para a inicial do rótulo. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
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
    setWindows((current) =>
      current.some((item) => item.id === next.id) ? current : [...current, next],
    );
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
