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
  GenericModuleIcon,
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
} from "../home/icons";

export type ModuleIcon = {
  /** Ícone de traço, usado quando não há imagem (ou enquanto ela não chega). */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  image?: string;
  imagePlaceholder?: string;
  /** Multiplicador do tamanho padrão do ícone (60px) — ajuste por asset. */
  scale?: number;
  /** Selo "+" sobre o ícone. É decoração do tile, não dado de catálogo. */
  badge?: "add";
};

/**
 * Registro de ícones: chave de ícone (`modules.icon_key`) → asset.
 *
 * A outra metade do que **não cabe no Postgres**: `import x from "...webp"` é
 * resolvido pelo Vite no build (hash no nome do arquivo, inline do placeholder),
 * então uma string guardada no banco nunca viraria um asset. O banco guarda a
 * *chave*; o bundle guarda a imagem.
 */
export const MODULE_ICONS: Record<string, ModuleIcon> = {
  "ajuste-estoque": {
    icon: StockAdjustIcon,
    image: ajusteEstoqueIcon,
    imagePlaceholder: AJUSTE_ESTOQUE_PLACEHOLDER,
  },
  "clientes-fornecedores": {
    icon: ClientsIcon,
    image: clientesFornecedoresIcon,
    imagePlaceholder: CLIENTES_FORNECEDORES_PLACEHOLDER,
    badge: "add",
  },
  compras: {
    icon: PurchasesIcon,
    image: comprasIcon,
    imagePlaceholder: COMPRAS_PLACEHOLDER,
    scale: 1.5625,
  },
  condicionais: {
    icon: RefreshIcon,
    image: condicionaisIcon,
    imagePlaceholder: CONDICIONAIS_PLACEHOLDER,
  },
  "controle-caixa": {
    icon: CashControlIcon,
    image: controleCaixaIcon,
    imagePlaceholder: CONTROLE_CAIXA_PLACEHOLDER,
  },
  "devolucao-venda": {
    icon: SaleReturnIcon,
    image: devolucaoVendaIcon,
    imagePlaceholder: DEVOLUCAO_VENDA_PLACEHOLDER,
  },
  financeiro: {
    icon: FinanceIcon,
    image: financeiroIcon,
    imagePlaceholder: FINANCEIRO_PLACEHOLDER,
  },
  "notas-emitidas": {
    icon: InvoicesIcon,
    image: notasEmitidasIcon,
    imagePlaceholder: NOTAS_EMITIDAS_PLACEHOLDER,
  },
  "pedidos-venda": {
    icon: SaleOrdersIcon,
    image: pedidosVendaIcon,
    imagePlaceholder: PEDIDOS_VENDA_PLACEHOLDER,
  },
  "ponto-de-venda": {
    icon: PosIcon,
    image: pontoDeVendaIcon,
    imagePlaceholder: PONTO_DE_VENDA_PLACEHOLDER,
  },
  produtos: {
    icon: ProductsIcon,
    image: produtosIcon,
    imagePlaceholder: PRODUTOS_PLACEHOLDER,
  },
  "realizar-venda": {
    icon: SaleHandIcon,
    image: realizarVendaIcon,
    imagePlaceholder: REALIZAR_VENDA_PLACEHOLDER,
  },
  relatorios: {
    icon: ReportsIcon,
    image: relatoriosIcon,
    imagePlaceholder: RELATORIOS_PLACEHOLDER,
  },
  tributacoes: {
    icon: TaxIcon,
    image: tributacoesIcon,
    imagePlaceholder: TRIBUTACOES_PLACEHOLDER,
  },
  "usuarios-operadores": {
    icon: UsersIcon,
    image: usuariosOperadoresIcon,
    imagePlaceholder: USUARIOS_OPERADORES_PLACEHOLDER,
  },
};

/** Ícone genérico de reserva — o que um módulo criado pelo usuário usa em M3. */
export const FALLBACK_MODULE_ICON: ModuleIcon = { icon: GenericModuleIcon };

export function moduleIconFor(iconKey: string | null | undefined): ModuleIcon {
  return (iconKey && MODULE_ICONS[iconKey]) || FALLBACK_MODULE_ICON;
}
