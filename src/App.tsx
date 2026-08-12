import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { OpenWindowsProvider } from "./components/openWindows";
import LoginPage from "./features/auth/LoginPage";
import CashControlPage from "./features/cashcontrol/CashControlPage";
import ConditionalsPage from "./features/conditionals/ConditionalsPage";
import CustomersPage from "./features/customers/CustomersPage";
import FinancePage from "./features/finance/FinancePage";
import HomePage from "./features/home/HomePage";
import PosPage from "./features/pos/PosPage";
import ProductsPage from "./features/products/ProductsPage";
import StockAdjustPage from "./features/products/StockAdjustPage";
import PurchasesPage from "./features/purchases/PurchasesPage";
import InvoicesPage from "./features/sales/InvoicesPage";
import SaleOrdersPage from "./features/sales/SaleOrdersPage";
import SalePage from "./features/sales/SalePage";
import SaleReturnPage from "./features/sales/SaleReturnPage";
import SettingsPage from "./features/settings/SettingsPage";
import TaxationsPage from "./features/taxations/TaxationsPage";
import UsersPage from "./features/users/UsersPage";

function App() {
  return (
    <BrowserRouter>
      <OpenWindowsProvider>
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
      </OpenWindowsProvider>
    </BrowserRouter>
  );
}

export default App;
