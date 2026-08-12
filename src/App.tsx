import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { OpenWindowsProvider } from "./components/openWindows";
import LoginPage from "./features/auth/LoginPage";
import CustomersPage from "./features/customers/CustomersPage";
import HomePage from "./features/home/HomePage";
import ProductsPage from "./features/products/ProductsPage";
import SaleOrdersPage from "./features/sales/SaleOrdersPage";
import SalePage from "./features/sales/SalePage";
import SettingsPage from "./features/settings/SettingsPage";

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
          <Route path="/configuracoes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </OpenWindowsProvider>
    </BrowserRouter>
  );
}

export default App;
