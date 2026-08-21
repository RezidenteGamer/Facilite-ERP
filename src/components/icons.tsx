import type { SVGProps } from "react";

/**
 * Ícones de "chrome" do app (navegação, busca, voltar) — usados pelo cabeçalho
 * e pelas abas flutuantes em qualquer tela/layout, não só na home.
 * Traço próprio, viewBox 24x24, cor herdada via `currentColor`.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function HouseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9.5h12V10" />
      <rect x="10" y="14" width="4" height="5.5" />
    </svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="9.5" width="6" height="10.5" />
      <rect x="12" y="4" width="8.5" height="16" />
      <line x1="5.5" y1="12.2" x2="7.5" y2="12.2" />
      <line x1="5.5" y1="15.2" x2="7.5" y2="15.2" />
      <line x1="14.5" y1="7.2" x2="18" y2="7.2" />
      <line x1="14.5" y1="10.2" x2="18" y2="10.2" />
      <line x1="14.5" y1="13.2" x2="18" y2="13.2" />
    </svg>
  );
}

export function HeadsetIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 13.5v-1.7a7.5 7.5 0 0 1 15 0v1.7" />
      <rect x="3" y="13" width="4" height="6.2" rx="1.4" />
      <rect x="17" y="13" width="4" height="6.2" rx="1.4" />
      <path d="M19.5 19.2v.6a2.7 2.7 0 0 1-2.7 2.7h-2.6" />
    </svg>
  );
}

/* Engrenagem "de verdade" (dentes + miolo) — a versão anterior era um
   círculo tracejado, abstrato demais pra ler como configurações num
   relance. */
export function GearIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.8" cy="10.8" r="6" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 4.5 19.5 9.5 8 21H3v-5Z" />
      <line x1="12.5" y1="6.5" x2="17.5" y2="11.5" />
    </svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="4" y1="12" x2="17" y2="12" />
      <path d="M12.5 6.5 18 12l-5.5 5.5" />
    </svg>
  );
}

/* Seta sólida (não traço) do botão "Voltar geral" — vetor próprio, então
   fica nítida em qualquer tamanho/tela, sem os problemas de borrão de
   raster. `fill="currentColor"` (não usa `base`, que é fill:none) —
   herda a cor do botão via CSS, como os outros ícones do sistema. */
export function BackArrowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 42 42" fill="currentColor" {...props}>
      <polygon fillRule="evenodd" points="31,38.32 13.391,21 31,3.68 28.279,1 8,21.01 28.279,41" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={2.4}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21.5" />
      <line x1="4.2" y1="4.2" x2="6" y2="6" />
      <line x1="18" y1="18" x2="19.8" y2="19.8" />
      <line x1="2.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21.5" y2="12" />
      <line x1="4.2" y1="19.8" x2="6" y2="18" />
      <line x1="18" y1="6" x2="19.8" y2="4.2" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.7 6.7 0 0 0 10.2 10.2Z" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12C4.8 7.5 8.2 5.2 12 5.2s7.2 2.3 9.5 6.8c-2.3 4.5-5.7 6.8-9.5 6.8S4.8 16.5 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 3.5 20.5 20.5" />
      <path d="M9.9 6.05A9.9 9.9 0 0 1 12 5.2c3.8 0 7.2 2.3 9.5 6.8a13.6 13.6 0 0 1-3.06 3.96M6.6 7.24C4.94 8.4 3.55 9.98 2.5 12c1.55 3.02 3.6 5.02 5.98 6.06A9.9 9.9 0 0 0 12 18.8c1.02 0 2-.15 2.94-.44" />
      <path d="M9.9 12a2.8 2.8 0 0 0 4 2.51" />
    </svg>
  );
}

/** Confirma visualmente um estado "ok" sem depender só de cor (ex.: pagamento batendo com o total). */
export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={2.2}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

/** Sinaliza um estado "atenção" sem depender só de cor (ex.: pagamento não bate com o total). */
export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={2.2}>
      <path d="M12 3.5 22 20.5H2Z" strokeLinejoin="round" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <line x1="12" y1="16.8" x2="12" y2="16.81" />
    </svg>
  );
}
