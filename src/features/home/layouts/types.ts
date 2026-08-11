/**
 * Layouts disponíveis para a tela inicial. Só "original" existe por enquanto —
 * "foco" e "desktop" entram aqui quando forem construídos, sem mudar mais nada
 * (ver layouts/index.ts e HomePage.tsx).
 */
export type HomeLayoutId = "original" | "foco" | "desktop";

export const HOME_LAYOUT_LABELS: Record<HomeLayoutId, string> = {
  original: "Original",
  foco: "Foco",
  desktop: "Desktop",
};
