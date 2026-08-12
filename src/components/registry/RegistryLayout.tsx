import type { ReactNode } from "react";
import "./RegistryLayout.css";

type RegistryLayoutProps = {
  /**
   * "three" (padrão): ações | tabela | ficha (Clientes, Produtos).
   * "table-controls": tabela | controles, sem a coluna de ações à esquerda
   * (Pedidos de venda, Notas emitidas, Financeiro).
   * "single": só a tabela, ocupando a largura toda (Tributações).
   */
  variant?: "three" | "table-controls" | "single";
  children: ReactNode;
};

const VARIANT_CLASS: Record<NonNullable<RegistryLayoutProps["variant"]>, string> = {
  three: "",
  "table-controls": " registry--table-controls",
  single: " registry--single",
};

/**
 * Estrutura em colunas dos módulos internos. Ocupa toda a altura do miolo
 * (AppShell em fillViewport), então as colunas laterais ficam paradas e só a
 * tabela do meio rola por dentro.
 */
export default function RegistryLayout({ variant = "three", children }: RegistryLayoutProps) {
  return <div className={`registry${VARIANT_CLASS[variant]}`}>{children}</div>;
}
