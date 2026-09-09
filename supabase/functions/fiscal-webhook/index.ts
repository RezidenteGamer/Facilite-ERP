/**
 * **`fiscal-webhook` — a porta por onde a Focus avisa que a nota mudou (A8,
 * 09/09/2026). Construída e desligada.**
 *
 * É a sexta tarefa da Etapa 3 e a terceira porta de entrada da mesma máquina.
 * As outras duas: o botão "Consultar status" (A6) e a varredura agendada (A7).
 * As três terminam no mesmo lugar — `reconciliaComProvedor` em
 * `fiscal-emit/reconcile.ts`, que passa a resposta do provedor por
 * `decideConsulta` (`fiscal-emit/reservation.ts`). **Esta função não decide
 * nada de novo**, e é isso que ela existe para provar.
 *
 * ## O mecanismo da Focus, pesquisado antes de escrever isto
 *
 * - **Ela chama a nossa URL com `POST` e um JSON**, com os dados de **um
 *   documento por vez** — notificação assíncrona de verdade, disparada quando o
 *   documento muda de estado.
 * - **A autenticação não é assinatura de payload.** Ao criar o gatilho
 *   (`POST /v2/hooks`) escolhem-se o **nome do header** (`authorization_header`)
 *   e o **valor** (`authorization`) que ela mandará em toda chamada — o mesmo
 *   desenho que A7 já usava na varredura.
 * - **Reenvio automático quando a resposta não é 2xx**: 1 min, 30 min, 1 h,
 *   3 h, 24 h — e depois disso ela **desiste** daquele evento.
 * - **O corpo da notificação não é documentado** em lugar nenhum do índice
 *   atual. Ver `payload.ts`, onde está a conferência página a página.
 *
 * Fontes: <https://doc.focusnfe.com.br/reference/webhooks> (`updatedAt`
 * 10/04/2026) e <https://doc.focusnfe.com.br/reference/criar_webhook>, acesso
 * em 09/09/2026.
 *
 * ## A decisão central: a notificação é um aviso, não um extrato
 *
 * O corpo diz "olhe a `ref` X". A função lê **só a `ref`** e vai perguntar ao
 * provedor o que aconteceu — o mesmo `provider.query(ref)` de A6 e A7. Isso
 * custa uma requisição a mais (1 crédito dos 100 por minuto que a Focus
 * documenta; ver A7 no AGENTS.md) e compra duas coisas que valem muito mais:
 *
 * 1. **Nenhuma escrituração fiscal a partir de formato suposto.** O corpo não é
 *    documentado; gravar `chave`, `status` e `protocolo` a partir dele seria
 *    apostar na forma dele.
 * 2. **O segredo deixa de ser a autoridade sobre o conteúdo.** Ele é um valor
 *    fixo num header, não uma assinatura: quem o tivesse poderia declarar
 *    qualquer `ref` como autorizada, com a chave que quisesse, se o corpo fosse
 *    a verdade. Perguntando ao provedor, o pior que um chamador com o segredo
 *    consegue é nos fazer **perguntar** sobre uma `ref` — e a resposta vem por
 *    um `GET` autenticado com o nosso token.
 *
 * O efeito colateral é bom: a escada de reenvio da Focus vira a nossa
 * retentativa. Se a consulta ao provedor falhar, respondemos 500, e ela volta em
 * 1 minuto. Se ela desistir depois de 24 h, a fila de A7 continua perseguindo a
 * reserva a cada 6 h, para sempre — as duas se cobrem.
 *
 * ## Uma função separada, e não uma quinta ação de `fiscal-emit`
 *
 * `fiscal-emit` tem `verify_jwt = true`, e baixá-lo abriria `emit`, `cancel` e
 * `query` junto (A7 já registrou isso no `config.toml`). Quem chama aqui é a
 * Focus: não tem usuário, não tem sessão do Supabase Auth, e não tem como
 * mandar a chave anônima no `Authorization` — aquele header é justamente o que
 * o gatilho usa para o **nosso** segredo, se quisermos. Daí
 * `verify_jwt = false` para esta função, e só para ela.
 *
 * ## O que "construída e desligada" significa tecnicamente
 *
 * Três travas independentes, e **cada uma sozinha** já impede que esta função
 * faça qualquer coisa hoje:
 *
 * 1. **`FISCAL_WEBHOOK_SECRET` não está definida.** Sem ela, toda requisição
 *    recebe 503 antes de ler o corpo, consultar o banco ou falar com o provedor.
 *    É a mesma disciplina de falha fechada de A7 (`FISCAL_QUEUE_SECRET`), e é o
 *    interruptor: ligar esta função é criar o segredo, desligá-la é apagá-lo.
 * 2. **Nenhum gatilho está cadastrado na Focus.** Não há conta real (A12), e
 *    esta tarefa não cadastrou nada — ninguém conhece esta URL.
 * 3. **A função não foi implantada.** A8 não implantou `fiscal-webhook` nem
 *    `fiscal-emit`.
 *
 * Quando A12 for ligar, a ordem é a mesma de A7: criar o segredo
 * (`supabase secrets set FISCAL_WEBHOOK_SECRET=...`), implantar, e só então
 * cadastrar o gatilho com `authorization_header` igual a
 * `FISCAL_WEBHOOK_HEADER` (ou o padrão abaixo) e `authorization` igual ao
 * segredo. Fora de ordem nada quebra de forma perigosa: a Focus recebe 503 ou
 * 401 e reenvia.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { describeRefOrigin } from "../_shared/fiscal/refs.ts";
import { resolveFiscalProviderId } from "../_shared/fiscal/registry.ts";
import { decideAcessoPorSegredo } from "../_shared/http/sharedSecret.ts";

// Esta função importa o núcleo de `fiscal-emit` de propósito: reimplementar a
// reconciliação aqui produziria uma segunda opinião sobre o que fazer com a
// resposta do provedor, e duas opiniões sobre nota fiscal divergem no primeiro
// caso difícil. Ver o cabeçalho de `fiscal-emit/reconcile.ts`.
import { clearQueueEntry, readDocumentByRef } from "../fiscal-emit/persist.ts";
import { reconciliaComProvedor, resolveAmbiente } from "../fiscal-emit/reconcile.ts";
import { RESERVA_STATUS } from "../fiscal-emit/reservation.ts";

import { leNotificacaoFocus } from "./payload.ts";

/**
 * O nome do header em que a Focus manda o segredo.
 *
 * Configurável porque **quem escolhe o nome somos nós**, no cadastro do gatilho
 * (`authorization_header`), e A12 pode ter motivo para outro. O padrão segue a
 * grafia de A7 (`x-fiscal-queue-secret`) para as duas portas se parecerem no
 * log e no painel.
 */
const HEADER_PADRAO = "x-fiscal-webhook-secret";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * **Sem CORS, de propósito.** Nenhum navegador chama esta URL: quem chama é o
 * servidor da Focus. Um `Access-Control-Allow-Origin: *` aqui só serviria para
 * uma página qualquer conseguir disparar a porta a partir do navegador de quem
 * a abrisse.
 */
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  // A autenticação vem **antes** de ler o corpo, consultar o banco ou falar com
  // o provedor: enquanto o segredo não existir, esta porta não gasta nada.
  const header = (Deno.env.get("FISCAL_WEBHOOK_HEADER")?.trim() || HEADER_PADRAO).toLowerCase();
  const recusa = decideAcessoPorSegredo(
    req.headers.get(header),
    Deno.env.get("FISCAL_WEBHOOK_SECRET"),
    { porta: "A notificação fiscal", variavel: "FISCAL_WEBHOOK_SECRET" },
  );
  if (recusa) return jsonResponse({ error: recusa.error }, recusa.status);

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido." }, 400);
  }

  const leitura = leNotificacaoFocus(corpo);
  if (!leitura.ok) {
    console.error("[fiscal-webhook] notificação ilegível:", leitura.motivo);
    return jsonResponse({ error: leitura.motivo }, 400);
  }
  const { ref, cnpjEmitente, statusInformado, campos } = leitura.notificacao;

  // O formato do corpo não é documentado (ver `payload.ts`); esta linha é o que
  // vai documentá-lo quando A12 ligar o gatilho de verdade. Só os **nomes** das
  // chaves — os valores carregam dado fiscal e não vão para o log.
  console.log(
    "[fiscal-webhook] notificação",
    JSON.stringify({ ref, cnpjEmitente, statusInformado, campos }),
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const existing = await readDocumentByRef(admin, ref);
    if (!existing) {
      // Não é erro nosso nem dela: o mesmo token da Focus pode emitir por outros
      // sistemas, e uma `ref` que não é nossa nunca vai ser. **200**, porque
      // reenviar não mudaria nada — e um não-2xx aqui gastaria as cinco
      // tentativas da escada da Focus para chegar à mesma conclusão.
      console.log("[fiscal-webhook] ref desconhecida, ignorada", ref);
      return jsonResponse({ ok: true, resultado: "ignorado", motivo: "ref desconhecida" });
    }

    const eraReserva = existing.status === RESERVA_STATUS;
    const providerId = resolveFiscalProviderId(Deno.env.get("FISCAL_PROVIDER"), (m) =>
      console.warn(m),
    );

    const { decisao, aplicado } = await reconciliaComProvedor(
      { admin, providerId, ambiente: resolveAmbiente(providerId) },
      existing,
      describeRefOrigin(existing.ref),
      { createdBy: null, origemEscrita: "webhook" },
    );

    // A notificação alegou um status e a reconciliação terminou em outro. Não
    // muda decisão nenhuma — quem decide é a resposta do provedor —, mas é
    // exatamente o sintoma de um gatilho mal cadastrado (o evento errado, o CNPJ
    // errado) e de um corpo cujo formato mudou, e os dois são invisíveis se
    // ninguém registrar.
    //
    // O campo se chama `statusResultante`, e não "status do provedor", porque
    // nem sempre é isso: em `manter`, `extra.status` é o que o **banco** já
    // dizia (`decideConsulta` não escreve nada nesse ramo). O que importa aqui
    // é a divergência entre o que foi anunciado e onde a linha ficou; dar ao
    // campo o nome mais forte faria o log mentir justamente no ramo em que
    // ninguém perguntou nada de novo ao provedor.
    const statusResultante = decisao.extra.status;
    if (
      statusInformado &&
      typeof statusResultante === "string" &&
      statusInformado !== statusResultante
    ) {
      console.warn(
        "[fiscal-webhook] a notificação e a reconciliação discordam",
        JSON.stringify({ ref, statusInformado, statusResultante, decisao: decisao.kind }),
      );
    }

    // A linha saiu de `processando_autorizacao`: não há mais o que a fila de A7
    // persiga. `clearQueueEntry` é o mesmo caminho que a própria varredura usa —
    // não existe um segundo jeito de tirar da fila, e é de propósito.
    if (eraReserva && decisao.kind !== "manter") {
      await clearQueueEntry(admin, existing.id);
    }

    console.log(
      "[fiscal-webhook] reconciliado",
      JSON.stringify({ ref, decisao: decisao.kind, aplicado, eraReserva }),
    );
    return jsonResponse({ ok: true, resultado: decisao.kind, aplicado });
  } catch (err) {
    // **500 de propósito**: um erro aqui é transporte (o provedor fora do ar, o
    // banco indisponível), e a resposta não-2xx é o que faz a Focus reenviar em
    // 1 min, 30 min, 1 h, 3 h e 24 h. Responder 200 para não "sujar" o painel
    // dela transformaria uma falha temporária em notificação perdida.
    const message = err instanceof Error && err.message ? err.message : String(err);
    console.error("[fiscal-webhook]", ref, message);
    return jsonResponse({ error: message }, 500);
  }
});
