import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Registro de componentes: id do módulo → tela própria dele.
 *
 * Esta é a metade do catálogo que **não cabe no Postgres**. Um componente
 * React não é um dado; o banco não teria como validar que ele existe, então
 * uma coluna "tem componente próprio?" divergiria da realidade no primeiro
 * rename de arquivo. A regra é simples e tem uma fonte só: **está aqui, tem
 * componente próprio; não está, vai para o motor genérico**.
 *
 * É por isso que um módulo criado pelo usuário (M3) funciona sem deploy —
 * ele nunca vai ter entrada aqui, e não precisa ter.
 *
 * Continua tudo carregado sob demanda (`lazy`), como era quando estes
 * `import()` moravam soltos no `App.tsx`.
 */
export const MODULE_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  "ajuste-estoque": lazy(() => import("../products/StockAdjustPage")),
  "clientes-fornecedores": lazy(() => import("../customers/CustomersPage")),
  compras: lazy(() => import("../purchases/PurchasesPage")),
  condicionais: lazy(() => import("../conditionals/ConditionalsPage")),
  configuracoes: lazy(() => import("../settings/SettingsPage")),
  "controle-caixa": lazy(() => import("../cashcontrol/CashControlPage")),
  "devolucao-venda": lazy(() => import("../sales/SaleReturnPage")),
  financeiro: lazy(() => import("../finance/FinancePage")),
  "notas-emitidas": lazy(() => import("../sales/InvoicesPage")),
  "pedidos-venda": lazy(() => import("../sales/SaleOrdersPage")),
  permissoes: lazy(() => import("../permissions/PermissionsPage")),
  "ponto-de-venda": lazy(() => import("../pos/PosPage")),
  produtos: lazy(() => import("../products/ProductsPage")),
  "realizar-venda": lazy(() => import("../sales/SalePage")),
  "usuarios-operadores": lazy(() => import("../users/UsersPage")),
};

export type ModuleSubroute = {
  /** Módulo a que a tela pertence — herda o portão de acesso dele. */
  moduleId: string;
  path: string;
  component: LazyExoticComponent<ComponentType>;
};

/**
 * Telas extras de um módulo que já existe (o formulário de "nova compra", o
 * de "novo pedido"). **Não são entradas de catálogo**: ninguém navega até
 * elas pela tela inicial, elas não têm ícone e não fazem sentido sozinhas —
 * são um segundo cômodo do mesmo módulo. Ficam aqui, ao lado do registro de
 * componentes, porque também dependem de um componente que só o código tem.
 */
export const MODULE_SUBROUTES: ModuleSubroute[] = [
  {
    moduleId: "pedidos-venda",
    path: "/pedidos-venda/novo",
    component: lazy(() => import("../sales/SaleOrderFormPage")),
  },
  {
    moduleId: "compras",
    path: "/compras/nova",
    component: lazy(() => import("../purchases/PurchaseFormPage")),
  },
];
