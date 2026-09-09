/**
 * **A leitura da notificação da Focus — e por que ela extrai tão pouco.**
 *
 * ## O que a pesquisa encontrou (09/09/2026)
 *
 * A Focus documenta o **cadastro** do gatilho com precisão: `POST /v2/hooks`
 * com `event`, `url` e, opcionalmente, `authorization` (o valor) e
 * `authorization_header` (o nome do header) — e devolve o objeto `Hook` com
 * `id`, `url`, `event`, `cnpj`. Fonte:
 * <https://doc.focusnfe.com.br/reference/criar_webhook>, acesso em 09/09/2026.
 *
 * Sobre a **notificação** — o POST que ela faz na nossa URL — a documentação
 * atual diz três coisas, e só três: que os dados vão *"em formato JSON via
 * método POST"*, que *"cada acionamento do gatilho contém os dados de apenas um
 * documento"*, e que um POST que não responda 2xx é reenviado em **1 minuto, 30
 * minutos, 1 hora, 3 horas e 24 horas**, e depois disso não mais. Fonte:
 * <https://doc.focusnfe.com.br/reference/webhooks> (`updatedAt` 10/04/2026),
 * acesso em 09/09/2026.
 *
 * **Não há, em lugar nenhum da documentação atual, a lista de campos do corpo
 * da notificação nem um exemplo dele.** Conferido no índice inteiro
 * (`doc.focusnfe.com.br/llms.txt`, 161 linhas, acesso em 09/09/2026): as cinco
 * páginas de gatilho (`webhooks`, `criar_webhook`, `listar_webhooks`,
 * `consultar_webhook`, `excluir_webhook`) e as doze de reenvio
 * (`reenviar_hook_*`) descrevem o objeto **Hook** — o cadastro —, nunca o corpo
 * enviado.
 *
 * ## A consequência de desenho: o corpo é aviso, não verdade
 *
 * Esta função **não** traduz o corpo para `FiscalDocument`, e a ausência é a
 * decisão central de A8. Ela extrai três coisas — quem é o documento (`ref`),
 * de quem ele é (`cnpj_emitente`) e o que a notificação alega (`status`) — e o
 * que decide o desfecho é a consulta ao provedor que vem depois. Duas razões,
 * cada uma suficiente sozinha:
 *
 * 1. **O formato não é documentado.** Escrever um tradutor a partir do formato
 *    da *consulta* (que é documentado) e gravá-lo em `fiscal_documents` seria
 *    escriturar nota fiscal a partir de uma suposição sobre o que chega.
 * 2. **O segredo não assina o corpo.** A autenticação da Focus é um header com
 *    valor fixo (ver `_shared/http/sharedSecret.ts`), não uma assinatura do
 *    payload. Se o corpo fosse a verdade, quem tivesse o segredo poderia
 *    declarar qualquer `ref` como `autorizado`, com a chave que quisesse.
 *    Consultando, o corpo só consegue **apontar** para uma `ref`; o status vem
 *    de um `GET` autenticado com o nosso token, pelo mesmo caminho de A6/A7.
 *
 * O raciocínio completo está no cabeçalho de `index.ts`.
 *
 * ## Por que `campos` existe
 *
 * `campos` são os nomes das chaves de topo do corpo recebido — **só os nomes**,
 * nunca os valores, que carregam dado fiscal e não têm o que fazer num log. Ele
 * é registrado a cada notificação por um motivo prático: quando A12 cadastrar o
 * gatilho de verdade, esta linha de log é o que vai documentar o formato que a
 * documentação não documenta. É a única forma honesta de descobri-lo — por
 * observação, não por adivinhação.
 *
 * ## Por que este arquivo não tem I/O
 *
 * Mesmo motivo de `reservation.ts` e `queue.ts`: é o que dá para cobrir com
 * teste sem rede (`tests/unit/fiscalWebhookPayload.test.ts`). Nada aqui toca
 * `Deno`, `fetch` ou o banco.
 */

/**
 * O tamanho máximo aceito para a `ref`.
 *
 * As nossas têm 42 caracteres (`venda-` + UUID, ver `_shared/fiscal/refs.ts`).
 * O teto existe porque a `ref` vira filtro de uma consulta ao PostgREST, que
 * viaja na query string: um corpo com uma `ref` de megabytes daria uma URL
 * absurda em vez de uma recusa limpa. 200 é folgado para qualquer `ref` real e
 * apertado o bastante para isso não acontecer.
 */
export const REF_TAMANHO_MAXIMO = 200;

/** O que a notificação identifica, depois de lida. */
export type NotificacaoFocus = {
  /** O documento de que a notificação fala. É o único campo em que confiamos. */
  ref: string;
  /** O emitente, quando veio — só para o log; nada é decidido por ele. */
  cnpjEmitente: string | null;
  /**
   * O status que a notificação **alega**. Nunca é gravado: serve para comparar
   * com o que o provedor responder e registrar a divergência, se houver.
   */
  statusInformado: string | null;
  /** Os nomes das chaves de topo do corpo, ordenados. Ver o cabeçalho. */
  campos: string[];
};

export type LeituraDaNotificacao =
  | { ok: true; notificacao: NotificacaoFocus }
  | { ok: false; motivo: string };

function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

/**
 * Lê o corpo recebido no gatilho.
 *
 * Recusa (e não adivinha) em três casos, porque nos três não há documento
 * nenhum para reconciliar: corpo que não é objeto JSON, corpo sem `ref`, e
 * `ref` maior que o teto. Quem chama traduz a recusa em HTTP 400 — o que faz a
 * Focus reenviar e, ao fim da escada, registrar a falha do gatilho no painel
 * dela. Falhar visível é melhor que responder 2xx para uma notificação que não
 * entendemos: um 2xx mentiria dizendo "recebido e tratado", e a notificação
 * estaria perdida para sempre.
 */
export function leNotificacaoFocus(body: unknown): LeituraDaNotificacao {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, motivo: "O corpo da notificação não é um objeto JSON." };
  }

  const corpo = body as Record<string, unknown>;
  const ref = textoOuNulo(corpo.ref);
  if (!ref) {
    return { ok: false, motivo: "A notificação não traz `ref`." };
  }
  if (ref.length > REF_TAMANHO_MAXIMO) {
    return { ok: false, motivo: "A `ref` da notificação é longa demais para ser nossa." };
  }

  return {
    ok: true,
    notificacao: {
      ref,
      cnpjEmitente: textoOuNulo(corpo.cnpj_emitente),
      statusInformado: textoOuNulo(corpo.status),
      campos: Object.keys(corpo).sort(),
    },
  };
}
