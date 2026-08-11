import type { ReactNode } from "react";
import "./RegistryLayout.css";

type RegistryLayoutProps = {
  children: ReactNode;
};

/**
 * Estrutura de três colunas dos módulos de cadastro: ações | tabela | ficha.
 * Ocupa toda a altura do miolo (AppShell em fillViewport), então as colunas
 * laterais ficam paradas e só a tabela do meio rola por dentro.
 */
export default function RegistryLayout({ children }: RegistryLayoutProps) {
  return <div className="registry">{children}</div>;
}
