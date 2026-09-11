import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * O catálogo já chegou inteiro ao menos uma vez nesta aba? É `ref`, e não
   * estado, porque quem pergunta são os `catch` abaixo, que rodam depois de
   * um `await` e precisam da resposta de agora. Ver a nota no `catch` do
   * efeito.
   */
  const jaCarregouUmaVez = useRef(false);
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
      /*
       * `jaCarregouUmaVez` precisa zerar aqui, e não é detalhe: sair da conta
       * apaga `modules`, e sem este reset o login seguinte **na mesma aba**
       * manteria `status: "ready"` com a lista vazia. Nessa janela nenhuma
       * rota interna existe, e o `<Route path="*">` de `App.tsx` manda tudo
       * para `/` — quem acabou de logar voltaria para a tela de login. É
       * exatamente a armadilha que o comentário do topo deste arquivo
       * descreve, e o guarda contra ela é `status: "loading"`.
       */
      jaCarregouUmaVez.current = false;
      setModules([]);
      setError(null);
      setStatus("ready");
      return;
    }

    // Só volta para "carregando" quando ainda não há catálogo nenhum. Este
    // efeito **reroda a cada troca de objeto `session`** — e o supabase-js
    // troca esse objeto sozinho ao renovar o token e ao a aba voltar a ficar
    // visível. Piscar a tela de carregamento inteira porque o usuário trocou
    // de aba seria ruim; ver a próxima nota para o que era pior.
    if (!jaCarregouUmaVez.current) setStatus("loading");
    fetchModuleCatalog()
      .then((rows) => {
        if (cancelled) return;
        jaCarregouUmaVez.current = true;
        setModules(rows);
        setError(null);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        /*
         * **Uma releitura que falha não pode apagar o catálogo que já
         * funcionava.** Antes de E6 (10/09/2026) este `catch` fazia
         * `setModules([])` + `status: "error"` sem olhar se já havia
         * catálogo, e `App.tsx` troca a aplicação inteira por uma tela de
         * erro nesse estado.
         *
         * Encontrado testando o PDV offline no navegador, e é pior do que
         * parece: com a rede caída, bastava **voltar o foco para a aba** para
         * o supabase-js reemitir a sessão, este efeito rodar de novo, a
         * leitura falhar e o PDV inteiro — carrinho montado, venda em
         * andamento — ser substituído por "Não foi possível carregar o
         * catálogo de módulos". Com E6 o PDV passa a saber trabalhar sem
         * rede; de nada adiantaria se a moldura em volta dele se
         * autodestruísse no primeiro Alt+Tab.
         *
         * O catálogo de módulos é a lista de rotas e tiles do sistema. Ele
         * muda quando alguém cria ou exclui um módulo (M3) — não durante um
         * turno de caixa. Manter o último que carregou é, nesta falha,
         * sempre melhor do que não ter nenhum.
         */
        if (jaCarregouUmaVez.current) return;
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
      jaCarregouUmaVez.current = true;
      setError(null);
      setStatus("ready");
    } catch (err) {
      // Mesma regra do efeito acima: o catálogo que já estava valendo
      // sobrevive a uma releitura que falhou.
      if (jaCarregouUmaVez.current) return;
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
