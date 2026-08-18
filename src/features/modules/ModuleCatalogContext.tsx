import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchModuleCatalog, type CatalogModule } from "./catalog";

type CatalogStatus = "loading" | "ready" | "error";

type ModuleCatalogValue = {
  modules: CatalogModule[];
  status: CatalogStatus;
  error: string | null;
  byId: (id: string) => CatalogModule | undefined;
};

const ModuleCatalogContext = createContext<ModuleCatalogValue | null>(null);

/**
 * Carrega o catálogo de módulos uma vez por sessão e o compartilha entre os
 * três consumidores que antes tinham cada um a sua lista: o roteador, a tela
 * inicial e o dock.
 *
 * `status` existe por causa de um modo de falha concreto: com as rotas vindo
 * do banco, existe uma janela em que o catálogo ainda não chegou e **nenhuma**
 * rota interna existe. Se o `<Route path="*">` decidir nessa janela, um F5 em
 * `/produtos` manda o usuário para o login em vez da tela dele. Quem consome
 * precisa esperar `status !== "loading"` antes de concluir que uma rota não
 * existe — ver `App.tsx`.
 */
export function ModuleCatalogProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const [modules, setModules] = useState<CatalogModule[]>([]);
  const [status, setStatus] = useState<CatalogStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Enquanto a sessão não resolveu não dá para saber nem se haverá catálogo:
    // a policy de leitura de `modules` é só para `authenticated`.
    if (authLoading) {
      setStatus("loading");
      return;
    }

    // Sem sessão o catálogo é vazio de direito, não "ainda carregando" — só
    // as rotas públicas existem, e o `*` pode decidir na hora.
    if (!session) {
      setModules([]);
      setError(null);
      setStatus("ready");
      return;
    }

    setStatus("loading");
    fetchModuleCatalog()
      .then((rows) => {
        if (cancelled) return;
        setModules(rows);
        setError(null);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModules([]);
        setError(err instanceof Error ? err.message : "Erro ao carregar o catálogo de módulos.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [session, authLoading]);

  const value = useMemo<ModuleCatalogValue>(
    () => ({
      modules,
      status,
      error,
      byId: (id: string) => modules.find((module) => module.id === id),
    }),
    [modules, status, error],
  );

  return <ModuleCatalogContext.Provider value={value}>{children}</ModuleCatalogContext.Provider>;
}

export function useModuleCatalog() {
  const context = useContext(ModuleCatalogContext);
  if (!context) {
    throw new Error("useModuleCatalog precisa estar dentro de <ModuleCatalogProvider>");
  }
  return context;
}
