import type { ComponentType, SVGProps } from "react";
import ajusteEstoqueIcon from "../../assets/icons/modules/ajuste-estoque.webp";
import { AJUSTE_ESTOQUE_PLACEHOLDER } from "../../assets/icons/modules/ajuste-estoque.placeholder";
import clientesFornecedoresIcon from "../../assets/icons/modules/clientes-fornecedores.webp";
import { CLIENTES_FORNECEDORES_PLACEHOLDER } from "../../assets/icons/modules/clientes-fornecedores.placeholder";
import comprasIcon from "../../assets/icons/modules/compras.webp";
import { COMPRAS_PLACEHOLDER } from "../../assets/icons/modules/compras.placeholder";
import condicionaisIcon from "../../assets/icons/modules/condicionais.webp";
import { CONDICIONAIS_PLACEHOLDER } from "../../assets/icons/modules/condicionais.placeholder";
import controleCaixaIcon from "../../assets/icons/modules/controle-caixa.webp";
import { CONTROLE_CAIXA_PLACEHOLDER } from "../../assets/icons/modules/controle-caixa.placeholder";
import devolucaoVendaIcon from "../../assets/icons/modules/devolucao-venda.webp";
import { DEVOLUCAO_VENDA_PLACEHOLDER } from "../../assets/icons/modules/devolucao-venda.placeholder";
import financeiroIcon from "../../assets/icons/modules/financeiro.webp";
import { FINANCEIRO_PLACEHOLDER } from "../../assets/icons/modules/financeiro.placeholder";
import notasEmitidasIcon from "../../assets/icons/modules/notas-emitidas.webp";
import { NOTAS_EMITIDAS_PLACEHOLDER } from "../../assets/icons/modules/notas-emitidas.placeholder";
import pedidosVendaIcon from "../../assets/icons/modules/pedidos-venda.webp";
import { PEDIDOS_VENDA_PLACEHOLDER } from "../../assets/icons/modules/pedidos-venda.placeholder";
import pontoDeVendaIcon from "../../assets/icons/modules/ponto-de-venda.webp";
import { PONTO_DE_VENDA_PLACEHOLDER } from "../../assets/icons/modules/ponto-de-venda.placeholder";
import produtosIcon from "../../assets/icons/modules/produtos.webp";
import { PRODUTOS_PLACEHOLDER } from "../../assets/icons/modules/produtos.placeholder";
import realizarVendaIcon from "../../assets/icons/modules/realizar-venda.webp";
import { REALIZAR_VENDA_PLACEHOLDER } from "../../assets/icons/modules/realizar-venda.placeholder";
import relatoriosIcon from "../../assets/icons/modules/relatorios.webp";
import { RELATORIOS_PLACEHOLDER } from "../../assets/icons/modules/relatorios.placeholder";
import tributacoesIcon from "../../assets/icons/modules/tributacoes.webp";
import { TRIBUTACOES_PLACEHOLDER } from "../../assets/icons/modules/tributacoes.placeholder";
import usuariosOperadoresIcon from "../../assets/icons/modules/usuarios-operadores.webp";
import { USUARIOS_OPERADORES_PLACEHOLDER } from "../../assets/icons/modules/usuarios-operadores.placeholder";
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
  /** Se vier preenchido, o ModuleTile mostra esta imagem no lugar de `icon`. */
  iconImage?: string;
  iconImagePlaceholder?: string;
  /** Multiplicador do tamanho padrão do ícone (60px) — só pra ajustes pontuais. */
  iconScale?: number;
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
    iconImage: clientesFornecedoresIcon,
    iconImagePlaceholder: CLIENTES_FORNECEDORES_PLACEHOLDER,
    badge: "add",
    path: "/clientes-fornecedores",
  },
  {
    id: "produtos",
    label: "Produtos",
    icon: ProductsIcon,
    iconImage: produtosIcon,
    iconImagePlaceholder: PRODUTOS_PLACEHOLDER,
    path: "/produtos",
  },
  {
    id: "realizar-venda",
    label: "Realizar uma venda",
    icon: SaleHandIcon,
    iconImage: realizarVendaIcon,
    iconImagePlaceholder: REALIZAR_VENDA_PLACEHOLDER,
    path: "/realizar-venda",
  },
  {
    id: "pedidos-venda",
    label: "Pedidos de venda",
    icon: SaleOrdersIcon,
    iconImage: pedidosVendaIcon,
    iconImagePlaceholder: PEDIDOS_VENDA_PLACEHOLDER,
    path: "/pedidos-venda",
  },
  {
    id: "notas-emitidas",
    label: "Notas emitidas",
    icon: InvoicesIcon,
    iconImage: notasEmitidasIcon,
    iconImagePlaceholder: NOTAS_EMITIDAS_PLACEHOLDER,
    path: "/notas-emitidas",
  },
  {
    id: "financeiro",
    label: "Financeiro",
    icon: FinanceIcon,
    iconImage: financeiroIcon,
    iconImagePlaceholder: FINANCEIRO_PLACEHOLDER,
    path: "/financeiro",
  },
  {
    id: "ponto-de-venda",
    label: "Ponto de venda",
    icon: PosIcon,
    iconImage: pontoDeVendaIcon,
    iconImagePlaceholder: PONTO_DE_VENDA_PLACEHOLDER,
    path: "/ponto-de-venda",
  },
  {
    id: "tributacoes",
    label: "Tributações",
    icon: TaxIcon,
    iconImage: tributacoesIcon,
    iconImagePlaceholder: TRIBUTACOES_PLACEHOLDER,
    path: "/tributacoes",
  },
  {
    id: "compras",
    label: "Compras",
    icon: PurchasesIcon,
    iconImage: comprasIcon,
    iconImagePlaceholder: COMPRAS_PLACEHOLDER,
    iconScale: 1.5625,
    path: "/compras",
  },
  {
    id: "devolucao-venda",
    label: "Devolução de venda",
    icon: SaleReturnIcon,
    iconImage: devolucaoVendaIcon,
    iconImagePlaceholder: DEVOLUCAO_VENDA_PLACEHOLDER,
    path: "/devolucao-venda",
  },
  {
    id: "ajuste-estoque",
    label: "Ajuste de estoque",
    icon: StockAdjustIcon,
    iconImage: ajusteEstoqueIcon,
    iconImagePlaceholder: AJUSTE_ESTOQUE_PLACEHOLDER,
    path: "/ajuste-estoque",
  },
  {
    id: "controle-caixa",
    label: "Controle de caixa",
    icon: CashControlIcon,
    iconImage: controleCaixaIcon,
    iconImagePlaceholder: CONTROLE_CAIXA_PLACEHOLDER,
    path: "/controle-caixa",
  },
  {
    id: "relatorios",
    label: "Relatórios",
    icon: ReportsIcon,
    iconImage: relatoriosIcon,
    iconImagePlaceholder: RELATORIOS_PLACEHOLDER,
  },
  {
    id: "usuarios-operadores",
    label: "Usuarios e Operadores",
    icon: UsersIcon,
    iconImage: usuariosOperadoresIcon,
    iconImagePlaceholder: USUARIOS_OPERADORES_PLACEHOLDER,
    path: "/usuarios-operadores",
  },
  {
    id: "condicionais",
    label: "Condicionais",
    icon: RefreshIcon,
    iconImage: condicionaisIcon,
    iconImagePlaceholder: CONDICIONAIS_PLACEHOLDER,
    path: "/condicionais",
  },
];
