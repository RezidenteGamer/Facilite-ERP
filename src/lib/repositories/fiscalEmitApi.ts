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

export type FiscalActionOutcome =
  | { ok: true; chave: string | null }
  | { ok: false; errors: string[] };

type FiscalEmitResponse = {
  ok?: boolean;
  errors?: string[];
  chave?: string | null;
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
    return { ok: true, chave: result.chave ?? null };
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
