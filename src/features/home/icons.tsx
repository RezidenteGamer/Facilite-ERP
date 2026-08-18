import type { SVGProps } from "react";

/**
 * Ícones de traço, todos em viewBox 24x24, `stroke="currentColor"`.
 * A cor vem do `color` do elemento pai — nenhum ícone define cor própria.
 * Desenhos originais (não são um recorte do pacote de ícones da referência).
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

export function ClientsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5 20c0-4 3.1-6.5 7-6.5s7 2.5 7 6.5" />
    </svg>
  );
}

export function ProductsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <rect x="7" y="6.5" width="4" height="3.5" />
      <rect x="13" y="14.5" width="4" height="3.5" />
    </svg>
  );
}

export function SaleHandIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.3" cy="12" r="6.8" />
      <text x="10.3" y="14.7" fontSize="7.2" textAnchor="middle" stroke="none" fill="currentColor">
        $
      </text>
      <path d="M15.2 15.6l2 2 4-4.6" />
    </svg>
  );
}

export function SaleOrdersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="11.5" x2="15" y2="11.5" />
      <line x1="9" y1="15" x2="13" y2="15" />
    </svg>
  );
}

export function InvoicesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5.5 3h8.2v11.4l-1.2-.8-1.2.8-1.2-.8-1.2.8-1.2-.8-1.2.8-1.2-.8V3z" />
      <line x1="7.3" y1="6.2" x2="12" y2="6.2" />
      <line x1="7.3" y1="8.7" x2="12" y2="8.7" />
      <circle cx="16.8" cy="16.8" r="4.4" />
      <text x="16.8" y="18.4" fontSize="4.9" textAnchor="middle" stroke="none" fill="currentColor">
        $
      </text>
    </svg>
  );
}

export function FinanceIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <rect x="7.5" y="5.5" width="9" height="3.5" rx="0.5" />
      <circle cx="8.5" cy="12.7" r="0.9" />
      <circle cx="12" cy="12.7" r="0.9" />
      <circle cx="15.5" cy="12.7" r="0.9" />
      <circle cx="8.5" cy="16.2" r="0.9" />
      <circle cx="12" cy="16.2" r="0.9" />
      <circle cx="15.5" cy="16.2" r="0.9" />
    </svg>
  );
}

export function PosIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <line x1="7" y1="8.3" x2="17" y2="8.3" />
      <line x1="7" y1="11.2" x2="13" y2="11.2" />
      <path d="M8 15v2.5M16 15v2.5M6 18h12" />
    </svg>
  );
}

export function TaxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <line x1="9" y1="7" x2="15" y2="7" />
      <line x1="9" y1="10" x2="13.5" y2="10" />
      <circle cx="15.5" cy="15.5" r="3.6" />
      <line x1="13.1" y1="17.9" x2="17.9" y2="13.1" />
    </svg>
  );
}

export function PurchasesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12h10.5" />
      <path d="M11 8.5 14.5 12 11 15.5" />
      <path d="M17.5 5.5h2a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2" />
    </svg>
  );
}

export function SaleReturnIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9.5" cy="20" r="1.2" />
      <circle cx="17" cy="20" r="1.2" />
      <path d="M3 5h2.2l2.1 10.4c.2.9 1 1.6 2 1.6h7a2 2 0 0 0 2-1.6L19.8 9H7" />
      <path d="M13.3 3v6.2M13.3 3l-2.2 2.2M13.3 3l2.2 2.2" />
    </svg>
  );
}

export function StockAdjustIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V10l8-6 8 6v10" />
      <path d="M2.5 20h19" />
      <rect x="9.7" y="13" width="4.6" height="7" />
    </svg>
  );
}

export function CashControlIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="8" width="16" height="11" rx="1.5" />
      <path d="M9 8V6.3A1.3 1.3 0 0 1 10.3 5h3.4A1.3 1.3 0 0 1 15 6.3V8" />
      <text x="12" y="15.6" fontSize="5" textAnchor="middle" stroke="none" fill="currentColor">
        $
      </text>
    </svg>
  );
}

export function ReportsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <polyline points="8,15.5 10.8,11.5 13,13.5 16,8.5" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8.3" r="2.7" />
      <path d="M4 19c0-3.1 2.2-5.2 5-5.2s5 2.1 5 5.2" />
      <circle cx="17" cy="9.3" r="2.1" />
      <path d="M14.9 19c.2-2.5 1.9-4.1 3.9-4.1 1 0 1.8.3 2.5.9" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1l1.8 1.8" />
      <path d="M19.5 4.8v4h-4" />
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1l-1.8-1.8" />
      <path d="M4.5 19.2v-4h4" />
    </svg>
  );
}

/**
 * Ícone de reserva para módulo sem asset próprio — é o que um módulo criado
 * pelo usuário (M3) vai usar até alguém desenhar um ícone para ele.
 */
export function GenericModuleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.4" />
    </svg>
  );
}
