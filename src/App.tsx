import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import RouteFallback from "./components/RouteFallback";
import { OpenWindowsProvider } from "./components/openWindows";
import LoginPage from "./features/auth/LoginPage";
import { ModuleCatalogProvider, useModuleCatalog } from "./features/modules/ModuleCatalogContext";
import ModuleRoute, { ModuleSubrouteGuard } from "./features/modules/ModuleRoute";
import { MODULE_SUBROUTES } from "./features/modules/moduleComponents";

// A tela inicial não é um módulo do catálogo (é o lugar de onde se abre os
// módulos), então continua declarada à mão — como o login.
const HomePage = lazy(() => import("./features/home/HomePage"));

/**
 * As rotas protegidas vêm do catálogo de módulos (tabela `modules`), não de
 * uma lista escrita à mão: cada linha com `path` vira uma `<Route>`, e o
 * componente de cada uma é resolvido pelo registro do código, caindo no motor
 * genérico quando o módulo não tem tela própria.
 *
 * O `<Route path="*">` é a parte delicada. Antes ele mandava qualquer rota
 * desconhecida para o login, o que era seguro quando a lista de rotas era
 * estática. Com o catálogo vindo do banco existe uma janela em que ele ainda
 * não chegou — e nessa janela *toda* rota é desconhecida. Decidir ali jogaria
 * quem deu F5 em `/produtos` na tela de login. Por isso o `*` só existe
 * depois que o catálogo resolveu; enquanto isso a tela é a de carregamento.
 */
function AppRoutes() {
  const { modules, status, error } = useModuleCatalog();

  if (status === "loading") return <RouteFallback />;

  if (status === "error") {
    return (
      <div style={{ color: "var(--white)", padding: 24 }} role="alert">
        <p>Não foi possível carregar o catálogo de módulos.</p>
        <p>{error}</p>
      </div>
    );
  }

  const routableModules = modules.filter((module) => module.path);

  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/inicio" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />

      {routableModules.map((module) => (
        <Route
          key={module.id}
          path={module.path as string}
          element={
            <ProtectedRoute>
              <ModuleRoute module={module} />
            </ProtectedRoute>
          }
        />
      ))}

      {MODULE_SUBROUTES.map(({ moduleId, path, component: Component }) => (
        <Route
          key={path}
          path={path}
          element={
            <ProtectedRoute>
              <ModuleSubrouteGuard module={modules.find((item) => item.id === moduleId)}>
                <Component />
              </ModuleSubrouteGuard>
            </ProtectedRoute>
          }
        />
      ))}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ModuleCatalogProvider>
        <OpenWindowsProvider>
          <Suspense fallback={<RouteFallback />}>
            <AppRoutes />
          </Suspense>
        </OpenWindowsProvider>
      </ModuleCatalogProvider>
    </BrowserRouter>
  );
}

export default App;
