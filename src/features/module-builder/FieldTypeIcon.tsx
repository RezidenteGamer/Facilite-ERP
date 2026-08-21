import type { ReactElement, SVGProps } from "react";
import type { ModuleFieldDefinition } from "../registry-engine/types";

/**
 * Um ícone por `data_type` do motor genérico — desenhados aqui, em traço, no
 * mesmo padrão de `src/components/icons.tsx` (viewBox 24x24, `currentColor`).
 *
 * Nada de asset externo: são cinco desenhos simples, e a correção do ícone de
 * Grupos tributários já mostrou que um componente de traço no próprio código
 * resolve — arquivo de imagem só acrescentaria um passo de build e um lugar a
 * mais para o ícone divergir do tema.
 *
 * O ícone **substitui** o texto "Texto"/"Data"/… no cartão do campo, mas
 * nunca sozinho: quem o desenha continua expondo o nome do tipo como rótulo
 * acessível (`aria-label`/`title`), porque um ícone de telefone e um de
 * e-mail não se distinguem sem legenda para quem nunca viu esta tela.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

/** Texto — o "A" de uma letra sobre a linha de base. */
export function TextTypeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 16.5 11 6.5l5 10" />
      <line x1="7.8" y1="13" x2="14.2" y2="13" />
      <line x1="4.5" y1="20" x2="19.5" y2="20" />
    </svg>
  );
}

/** Data — folhinha de calendário. */
export function DateTypeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <line x1="3.5" y1="10" x2="20.5" y2="10" />
      <line x1="8" y1="3.5" x2="8" y2="7" />
      <line x1="16" y1="3.5" x2="16" y2="7" />
      <rect x="7" y="13" width="3.4" height="3.2" rx="0.8" />
    </svg>
  );
}

/** E-mail — envelope com a aba aberta. */
export function EmailTypeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m3.8 7.5 7.1 5.3a2 2 0 0 0 2.4 0l7.1-5.3" />
    </svg>
  );
}

/** Telefone — o monofone clássico. */
export function PhoneTypeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.4 3.8 9.6 4.4a1.6 1.6 0 0 1 1.1 2l-.5 1.9a1.6 1.6 0 0 1-1.4 1.2l-1.3.1a10.5 10.5 0 0 0 6.9 6.9l.1-1.3a1.6 1.6 0 0 1 1.2-1.4l1.9-.5a1.6 1.6 0 0 1 2 1.1l.6 2.2a1.8 1.8 0 0 1-1.5 2.3C11.9 20 4 12.1 5.1 5.3a1.8 1.8 0 0 1 2.3-1.5Z" />
    </svg>
  );
}

/** Sim/Não — a chavinha, ligada. */
export function BooleanTypeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
      <circle cx="16.5" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const BY_TYPE: Record<ModuleFieldDefinition["dataType"], (props: IconProps) => ReactElement> = {
  text: TextTypeIcon,
  date: DateTypeIcon,
  email: EmailTypeIcon,
  phone: PhoneTypeIcon,
  boolean: BooleanTypeIcon,
};

type FieldTypeIconProps = IconProps & { dataType: ModuleFieldDefinition["dataType"] };

/** Despacha para o ícone do tipo; tipo desconhecido cai no de texto. */
export default function FieldTypeIcon({ dataType, ...props }: FieldTypeIconProps) {
  const Icon = BY_TYPE[dataType] ?? TextTypeIcon;
  return <Icon {...props} />;
}
