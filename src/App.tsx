import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
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
const PermissionsPage = lazy(() => import("./features/permissions/PermissionsPage"));
const PurchasesPage = lazy(() => import("./features/purchases/PurchasesPage"));
const InvoicesPage = lazy(() => import("./features/sales/InvoicesPage"));
const SaleOrderFormPage = lazy(() => import("./features/sales/SaleOrderFormPage"));
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
            <Route path="/inicio" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route
              path="/clientes-fornecedores"
              element={<ProtectedRoute><CustomersPage /></ProtectedRoute>}
            />
            <Route path="/produtos" element={<ProtectedRoute><ProductsPage /></ProtectedRoute>} />
            <Route path="/realizar-venda" element={<ProtectedRoute><SalePage /></ProtectedRoute>} />
            <Route path="/pedidos-venda" element={<ProtectedRoute><SaleOrdersPage /></ProtectedRoute>} />
            <Route path="/pedidos-venda/novo" element={<ProtectedRoute><SaleOrderFormPage /></ProtectedRoute>} />
            <Route path="/notas-emitidas" element={<ProtectedRoute><InvoicesPage /></ProtectedRoute>} />
            <Route path="/financeiro" element={<ProtectedRoute><FinancePage /></ProtectedRoute>} />
            <Route path="/ponto-de-venda" element={<ProtectedRoute><PosPage /></ProtectedRoute>} />
            <Route path="/tributacoes" element={<ProtectedRoute><TaxationsPage /></ProtectedRoute>} />
            <Route path="/compras" element={<ProtectedRoute><PurchasesPage /></ProtectedRoute>} />
            <Route path="/devolucao-venda" element={<ProtectedRoute><SaleReturnPage /></ProtectedRoute>} />
            <Route path="/ajuste-estoque" element={<ProtectedRoute><StockAdjustPage /></ProtectedRoute>} />
            <Route path="/controle-caixa" element={<ProtectedRoute><CashControlPage /></ProtectedRoute>} />
            <Route path="/usuarios-operadores" element={<ProtectedRoute><UsersPage /></ProtectedRoute>} />
            <Route path="/permissoes" element={<ProtectedRoute><PermissionsPage /></ProtectedRoute>} />
            <Route path="/condicionais" element={<ProtectedRoute><ConditionalsPage /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </OpenWindowsProvider>
    </BrowserRouter>
  );
}

export default App;
