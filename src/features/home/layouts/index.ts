import type { ComponentType } from "react";
import OriginalLayout from "./OriginalLayout";
import type { HomeLayoutId } from "./types";

export const DEFAULT_HOME_LAYOUT: HomeLayoutId = "original";

/**
 * Registro de layouts da tela inicial. "foco" e "desktop" ficam `null` até
 * serem construídos — HomePage cai para o padrão enquanto isso.
 * Adicionar um layout novo é só implementá-lo e apontar aqui, nada mais muda.
 */
export const HOME_LAYOUTS: Record<HomeLayoutId, ComponentType | null> = {
  original: OriginalLayout,
  foco: null,
  desktop: null,
};

export type { HomeLayoutId } from "./types";
export { HOME_LAYOUT_LABELS } from "./types";
