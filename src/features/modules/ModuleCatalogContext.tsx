import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchModuleCatalog, type CatalogModule } from "./catalog";

type CatalogStatus = "loading" | "ready" | "error";

type ModuleCatalogValue = {
  modules: CatalogModule[];
  status: CatalogStatus;
  error: string | null;
  byId: (id: string) => CatalogModule | undefined;
  /**
   * Relê o catálogo. Existe por causa do construtor de módulos (M3):
   * criar ou excluir um módulo muda a lista de rotas e de tiles na hora, e
   * sem isto a mudança só apareceria depois de um F5.
   */
  reload: () => Promise<void>;
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

  /* Recarrega sem passar por `loading`: quem chama já está numa tela
     montada, e voltar para a tela de carregamento do roteador no meio de um
     "Criar módulo" desmontaria a própria tela que disparou a ação. */
  const reload = useCallback(async () => {
    if (!session) return;
    try {
      setModules(await fetchModuleCatalog());
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar o catálogo de módulos.");
      setStatus("error");
    }
  }, [session]);

  const value = useMemo<ModuleCatalogValue>(
    () => ({
      modules,
      status,
      error,
      byId: (id: string) => modules.find((module) => module.id === id),
      reload,
    }),
    [modules, status, error, reload],
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
