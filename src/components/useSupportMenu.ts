import { useCallback, useEffect, useRef, useState } from "react";

/** Precisa bater com a duração de `support-menu-out` em SupportMenu.css. */
const CLOSE_ANIMATION_MS = 220;

/**
 * Estado do popup de Suporte, isolado do componente que o mostra — assim
 * mais de um gatilho (a aba flutuante, o link "Suporte" do menu superior)
 * pode abrir o mesmo popup sem duplicar lógica de abrir/fechar.
 */
export function useSupportMenu() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimeoutRef = useRef<number | undefined>(undefined);

  const openMenu = useCallback(() => setOpen(true), []);

  const requestClose = useCallback(() => {
    setClosing(true);
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(closeTimeoutRef.current), []);

  return { open, closing, openMenu, requestClose };
}
