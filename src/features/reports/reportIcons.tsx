import type { SVGProps } from "react";

/**
 * Ícones específicos de Relatórios que não existem em `home/icons.tsx` —
 * mesmo estilo de traço (viewBox 24x24, `stroke="currentColor"`) para caber
 * ao lado dos ícones reaproveitados de outros módulos na mesma grade.
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

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="5" width="16" height="15" rx="1.5" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
    </svg>
  );
}

export function AverageCostIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 19h14" />
      <path d="M7 19V11l5-6 5 6v8" />
      <line x1="9.5" y1="19" x2="9.5" y2="14" />
      <line x1="14.5" y1="19" x2="14.5" y2="14" />
    </svg>
  );
}

export function TopSellerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20h16" />
      <rect x="5.5" y="14" width="4" height="6" />
      <rect x="10" y="9" width="4" height="11" />
      <rect x="14.5" y="4" width="4" height="16" />
    </svg>
  );
}

export function LowStockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 21 19.5H3z" />
      <line x1="12" y1="9.5" x2="12" y2="14.2" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
