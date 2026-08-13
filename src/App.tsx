import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import RouteFallback from "./components/RouteFallback";
import { OpenWindowsProvider } from "./components/openWindows";
import LoginPage from "./features/auth/LoginPage";

// Rotas carregadas sob demanda: só a tela de login (rota "/", primeira coisa
// que qualquer usuário vê) entra no bundle inicial. O resto do sistema só é
// baixado quando o usuário efetivamente navega até lá.
const CashControlPage = lazy(() => import("./features/cashcontrol/CashControlPage"));
const ConditionalsPage = lazy(() => import("./features/conditionals/ConditionalsPage"));
const CustomersPage = lazy(() => import("./features/customers/CustomersPage"));
const FinancePage = lazy(() => import("./features/finance/FinancePage"));
const HomePage = lazy(() => import("./features/home/HomePage"));
const PosPage = lazy(() => import("./features/pos/PosPage"));
const ProductsPage = lazy(() => import("./features/products/ProductsPage"));
const StockAdjustPage = lazy(() => import("./features/products/StockAdjustPage"));
const PurchasesPage = lazy(() => import("./features/purchases/PurchasesPage"));
const InvoicesPage = lazy(() => import("./features/sales/InvoicesPage"));
const SaleOrdersPage = lazy(() => import("./features/sales/SaleOrdersPage"));
const SalePage = lazy(() => import("./features/sales/SalePage"));
const SaleReturnPage = lazy(() => import("./features/sales/SaleReturnPage"));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));
const TaxationsPage = lazy(() => import("./features/taxations/TaxationsPage"));
const UsersPage = lazy(() => import("./features/users/UsersPage"));

function App() {
  return (
    <BrowserRouter>
      <OpenWindowsProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route path="/inicio" element={<HomePage />} />
            <Route path="/clientes-fornecedores" element={<CustomersPage />} />
            <Route path="/produtos" element={<ProductsPage />} />
            <Route path="/realizar-venda" element={<SalePage />} />
            <Route path="/pedidos-venda" element={<SaleOrdersPage />} />
            <Route path="/notas-emitidas" element={<InvoicesPage />} />
            <Route path="/financeiro" element={<FinancePage />} />
            <Route path="/ponto-de-venda" element={<PosPage />} />
            <Route path="/tributacoes" element={<TaxationsPage />} />
            <Route path="/compras" element={<PurchasesPage />} />
            <Route path="/devolucao-venda" element={<SaleReturnPage />} />
            <Route path="/ajuste-estoque" element={<StockAdjustPage />} />
            <Route path="/controle-caixa" element={<CashControlPage />} />
            <Route path="/usuarios-operadores" element={<UsersPage />} />
            <Route path="/condicionais" element={<ConditionalsPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </OpenWindowsProvider>
    </BrowserRouter>
  );
}

export default App;
