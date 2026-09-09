/**
 * **A porta do front para a Edge Function `fiscal-emit` (A1, 01/09/2026).**
 *
 * Mesmo padrão de `adminUsersApi.ts`: um `fetch` para
 * `${supabaseUrl}/functions/v1/<função>` com o JWT da sessão no header, e
 * nenhum conhecimento sobre o que a função faz do outro lado.
 *
 * ## O que este arquivo deliberadamente NÃO faz
 *
 * Não monta `NfePayload`, não lê venda, não chama `getFiscalProvider()`, não
 * grava em `fiscal_documents`. Tudo isso saiu do bundle do navegador nesta
 * tarefa — o cliente diz **qual** venda ou devolução emitir e a Edge Function
 * lê do banco o resto. Nem a `ref` viaja daqui: ela é derivada do id do lado
 * do servidor (ver `supabase/functions/_shared/fiscal/refs.ts`).
 *
 * ## Nunca lança
 *
 * As três funções devolvem `{ ok, errors }` — o mesmo `EmitOutcome` de antes
 * de A1. Falha de rede, 401, 403 e 500 viram `errors` com a mensagem que a tela
 * já sabe exibir; rejeição da SEFAZ vem em HTTP 200 com `ok: false`, porque
 * rejeição é resultado de negócio (decisão de 18/08/2026). Quem precisa de
 * exceção (o modal de cancelamento, que já tratava assim) converte no seu lado.
 */
import { extractErrorMessage } from "../errorMessage";
import { supabase, supabaseUrl } from "../supabaseClient";

/** A origem do documento — venda ou devolução, nunca as duas. */
export type FiscalEmitOrigin = { saleId: string } | { saleReturnId: string };

/**
 * `status` e `mensagem` entraram em A6 (09/09/2026), para a consulta de status.
 *
 * Emitir e cancelar não os leem — ali o próprio botão clicado já diz o que
 * aconteceu. Consultar, não: o mesmo clique pode terminar em "o provedor
 * confirmou a autorização", "ainda está processando" ou "a emissão anterior não
 * foi concluída e a venda foi liberada", e quem sabe qual dos três é a Edge
 * Function. `mensagem` é a frase que ela escolheu; `status`, o estado em que a
 * nota ficou.
 */
export type FiscalActionOutcome =
  | { ok: true; chave: string | null; status: string | null; mensagem: string | null }
  | { ok: false; errors: string[] };

type FiscalEmitResponse = {
  ok?: boolean;
  errors?: string[];
  chave?: string | null;
  status?: string | null;
  mensagem?: string | null;
  /** Erro de transporte/permissão/configuração — a função responde com HTTP != 200. */
  error?: string;
  /**
   * O mesmo papel de `error`, mas vindo do **gateway** da Supabase, não da nossa
   * função: sessão expirada ou header ausente são recusados antes de a função
   * rodar (`verify_jwt = true` em `supabase/config.toml`), e a resposta é
   * `{ code, message }`. Sem ler este campo, o caso mais comum de falha —
   * "Invalid JWT", depois de a sessão expirar — apareceria na tela como a
   * mensagem genérica, escondendo que basta entrar de novo.
   */
  message?: string;
};

async function callFiscalEmit(body: Record<string, unknown>): Promise<FiscalActionOutcome> {
  try {
    if (!supabase) throw new Error("Supabase não está configurado.");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const response = await fetch(`${supabaseUrl}/functions/v1/fiscal-emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const result: FiscalEmitResponse = await response.json();
    if (!response.ok) {
      throw new Error(
        result.error ?? result.message ?? "Erro ao falar com o serviço de emissão fiscal.",
      );
    }
    if (!result.ok) {
      return { ok: false, errors: result.errors?.length ? result.errors : ["A emissão não foi concluída."] };
    }
    return {
      ok: true,
      chave: result.chave ?? null,
      status: result.status ?? null,
      mensagem: result.mensagem ?? null,
    };
  } catch (err) {
    return { ok: false, errors: [extractErrorMessage(err, "Erro inesperado ao falar com o serviço fiscal.")] };
  }
}

/** Emite a nota da venda ou da devolução informada, no modelo pedido. */
export function requestFiscalEmit(
  branchId: string,
  origin: FiscalEmitOrigin,
  model: "nfe" | "nfce",
): Promise<FiscalActionOutcome> {
  return callFiscalEmit({ action: "emit", branchId, model, ...origin });
}

/** Cancela a nota da venda ou da devolução informada. */
export function requestFiscalCancel(
  branchId: string,
  origin: FiscalEmitOrigin,
  justificativa: string,
): Promise<FiscalActionOutcome> {
  return callFiscalEmit({ action: "cancel", branchId, justificativa, ...origin });
}

/**
 * **Pergunta ao provedor o que ele sabe sobre a nota desta venda ou devolução,
 * e reconcilia o banco com a resposta** (A6, 09/09/2026).
 *
 * A ação `query` existia na Edge Function desde A1 e **nenhuma tela a chamava**
 * — não havia botão nenhum em `InvoicesPage.tsx` que a alcançasse. Sem ela, uma
 * nota presa em `processando_autorizacao` (um isolate morto no meio da emissão)
 * não tinha saída: `handleEmit` recusa reemitir por cima de uma reserva, e nada
 * mais tocava a linha.
 *
 * Exige só a permissão de `view` em Notas Emitidas — ela lê do provedor e
 * reconcilia; não emite, não cancela, não cria documento nenhum.
 */
export function requestFiscalQuery(
  branchId: string,
  origin: FiscalEmitOrigin,
): Promise<FiscalActionOutcome> {
  return callFiscalEmit({ action: "query", branchId, ...origin });
}
