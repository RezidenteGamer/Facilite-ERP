import type { SVGProps } from "react";

/**
 * Ícones de traço específicos do PDV, no mesmo estilo dos demais ícones do
 * app (viewBox 24x24, `stroke="currentColor"`, sem cor própria).
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

export function CartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 4h2.2l2.1 10.4c.2.9 1 1.6 2 1.6h7a2 2 0 0 0 2-1.6L19.8 8H7" />
      <circle cx="9.5" cy="19" r="1.2" />
      <circle cx="17" cy="19" r="1.2" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="9" y1="5.5" x2="9" y2="18.5" />
      <line x1="15" y1="5.5" x2="15" y2="18.5" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 5.2v13.6l11-6.8-11-6.8Z" />
    </svg>
  );
}

export function CancelSaleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}

export function GridViewIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ListViewIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <line x1="4" y1="6.5" x2="20" y2="6.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17.5" x2="20" y2="17.5" />
    </svg>
  );
}

export function CardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="1.6" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="6" y1="14.5" x2="10" y2="14.5" />
    </svg>
  );
}

export function PixIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.3 4.5h2.1c.6 0 1.2.25 1.6.7l3.3 3.3c.5.5.5 1.3 0 1.8l-3.3 3.3a2.2 2.2 0 0 1-1.6.7H8.3" />
      <path d="M15.7 19.5h-2.1c-.6 0-1.2-.25-1.6-.7l-3.3-3.3a1.27 1.27 0 0 1 0-1.8l3.3-3.3a2.2 2.2 0 0 1 1.6-.7h2.1" />
      <circle cx="12" cy="12" r="1.4" />
    </svg>
  );
}

export function SplitIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h4.5l7 12H20" />
      <path d="M4 18h4.5l2.4-4.1" />
      <path d="M17 3.5 20 6l-3 2.5" />
      <path d="M17 20.5 20 18l-3-2.5" />
    </svg>
  );
}

export function CropIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 3v13.5A1.5 1.5 0 0 0 8 18h9.5" />
      <path d="M17.5 21V7.5A1.5 1.5 0 0 0 16 6H2.5" />
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

export function FrameIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </svg>
  );
}
