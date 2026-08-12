import type { ComponentType, SVGProps } from "react";
import {
  CashControlIcon,
  ClientsIcon,
  FinanceIcon,
  InvoicesIcon,
  PosIcon,
  ProductsIcon,
  PurchasesIcon,
  RefreshIcon,
  ReportsIcon,
  SaleHandIcon,
  SaleOrdersIcon,
  SaleReturnIcon,
  StockAdjustIcon,
  TaxIcon,
  UsersIcon,
} from "./icons";

export type HomeModule = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: "add";
  /** Rota do módulo — sem isto o ícone ainda não leva a lugar nenhum. */
  path?: string;
};

/**
 * Lista única de módulos do ERP — cada layout ("Original", "Foco", "Desktop")
 * decide como organizar/exibir estes mesmos itens, sem duplicar os dados.
 */
export const HOME_MODULES: HomeModule[] = [
  {
    id: "clientes-fornecedores",
    label: "Clientes e Fornecedores",
    icon: ClientsIcon,
    badge: "add",
    path: "/clientes-fornecedores",
  },
  { id: "produtos", label: "Produtos", icon: ProductsIcon, path: "/produtos" },
  { id: "realizar-venda", label: "Realizar uma venda", icon: SaleHandIcon, path: "/realizar-venda" },
  { id: "pedidos-venda", label: "Pedidos de venda", icon: SaleOrdersIcon, path: "/pedidos-venda" },
  { id: "notas-emitidas", label: "Notas emitidas", icon: InvoicesIcon, path: "/notas-emitidas" },
  { id: "financeiro", label: "Financeiro", icon: FinanceIcon, path: "/financeiro" },
  { id: "ponto-de-venda", label: "Ponto de venda", icon: PosIcon, path: "/ponto-de-venda" },
  { id: "tributacoes", label: "Tributações", icon: TaxIcon, path: "/tributacoes" },
  { id: "compras", label: "Compras", icon: PurchasesIcon, path: "/compras" },
  { id: "devolucao-venda", label: "Devolução de venda", icon: SaleReturnIcon, path: "/devolucao-venda" },
  { id: "ajuste-estoque", label: "Ajuste de estoque", icon: StockAdjustIcon, path: "/ajuste-estoque" },
  { id: "controle-caixa", label: "Controle de caixa", icon: CashControlIcon, path: "/controle-caixa" },
  { id: "relatorios", label: "Relatórios", icon: ReportsIcon },
  { id: "usuarios-operadores", label: "Usuarios e Operadores", icon: UsersIcon, path: "/usuarios-operadores" },
  { id: "condicionais", label: "Condicionais", icon: RefreshIcon, path: "/condicionais" },
];
