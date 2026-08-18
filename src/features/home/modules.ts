import type { ComponentType, SVGProps } from "react";

/**
 * Um módulo já pronto para ser desenhado como tile na tela inicial.
 *
 * Isto é uma **forma de apresentação**, não mais um cadastro: até 18/08/2026
 * este arquivo exportava `HOME_MODULES`, uma lista de 15 módulos escrita à
 * mão que era a segunda fonte da verdade do sistema (a primeira eram as
 * `<Route>` do `App.tsx`, a terceira a tabela `modules`). Agora quem diz
 * quais módulos existem é o catálogo no banco, e quem diz com que imagem
 * cada um aparece é o registro de ícones do código
 * (`src/features/modules/moduleIcons.ts`). `useModuleOrder` junta os dois e
 * devolve estes objetos.
 */
export type HomeModule = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Se vier preenchido, o ModuleTile mostra esta imagem no lugar de `icon`. */
  iconImage?: string;
  iconImagePlaceholder?: string;
  /** Multiplicador do tamanho padrão do ícone (60px) — só pra ajustes pontuais. */
  iconScale?: number;
  badge?: "add";
  /** Rota do módulo — sem isto o ícone ainda não leva a lugar nenhum. */
  path?: string;
};
