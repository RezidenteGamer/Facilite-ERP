import { useEffect, useState } from "react";

export type IconsArrangement = "grid" | "sidebar";

const STORAGE_KEY = "facilite:home:icons-arrangement";

function loadStored(): IconsArrangement {
  try {
    return localStorage.getItem(STORAGE_KEY) === "sidebar" ? "sidebar" : "grid";
  } catch {
    return "grid";
  }
}

/**
 * Disposição dos ícones da home: "grid" (layout atual, em grade larga) ou
 * "sidebar" (mais compacta, encostada na lateral). Persistida no navegador,
 * trocável pelo menu de clique direito (ver IconsLayoutMenu).
 */
export function useIconsArrangement() {
  const [arrangement, setArrangement] = useState<IconsArrangement>(loadStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, arrangement);
    } catch {
      // Armazenamento indisponível — preferência não persiste, sem quebrar a tela.
    }
  }, [arrangement]);

  return { arrangement, setArrangement };
}
