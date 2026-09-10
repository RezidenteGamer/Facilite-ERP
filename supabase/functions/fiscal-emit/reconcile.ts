/**
 * **O núcleo de reconciliação com o provedor — o que os três chamadores dividem.**
 *
 * `reconciliaComProvedor` nasceu dentro de `handleQuery` (A6, 09/09/2026), foi
 * extraída para o topo de `index.ts` em A7 (09/09/2026) quando a varredura
 * agendada virou o segundo chamador, e mudou de arquivo em A8 (09/09/2026)
 * quando apareceu o terceiro: a Edge Function `fiscal-webhook`, que é um
 * processo **separado** e não pode importar `fiscal-emit/index.ts` — aquele
 * arquivo chama `Deno.serve` no corpo do módulo, e importá-lo subiria um
 * segundo servidor dentro do primeiro.
 *
 * **Nada de comportamento mudou na mudança de arquivo.** É recorte puro: as
 * mesmas cinco funções, com os mesmos corpos, agora exportadas. A decisão sobre
 * o que fazer com a resposta do provedor continua sendo uma só e continua em
 * `decideConsulta` (`reservation.ts`) — é justamente o que este arquivo existe
 * para não deixar duplicar.
 *
 * Os três chamadores, e a única coisa que os diferencia:
 *
 * | chamador | quem é | `createdBy` | `origem` |
 * | --- | --- | --- | --- |
 * | `handleQuery` (A6) | o operador clicando "Consultar status" | o usuário | `consulta` |
 * | `handleSweep` (A7) | o `pg_cron`, a cada 5 minutos | `null` | `fila` |
 * | `fiscal-webhook` (A8) | a Focus avisando que a nota mudou | `null` | `webhook` |
 *
 * Fora disso os três fazem exatamente a mesma coisa: consultam a `ref` no
 * provedor e gravam (ou liberam) o que `decideConsulta` mandar.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import { DANFE_CONTENT_TYPE, XML_CONTENT_TYPE } from "../_shared/fiscal/artifactContentTypes.ts";
import type { FiscalProvider } from "../_shared/fiscal/provider.ts";
import {
  createFiscalProvider,
  type FiscalProviderId,
} from "../_shared/fiscal/registry.ts";
import type { SimulatedFiscalProviderSeed } from "../_shared/fiscal/simulatedFiscalProvider.ts";
import type { FiscalArtifact, FiscalStatus } from "../_shared/fiscal/types.ts";

import {
  persistQueryStatus,
  releaseStuckReservation,
  type FiscalAmbiente,
  type FiscalDocumentRow,
  type OrigemReconciliacao,
} from "./persist.ts";
import { RESERVA_STATUS, decideConsulta, type ConsultaDecisao } from "./reservation.ts";

/**
 * O ambiente declarado na nota (`tpAmb`).
 *
 * Falha fechado em dois eixos: o provedor simulado é **sempre** homologação
 * (um documento que ninguém enviou à SEFAZ nunca tem valor fiscal, por mais que
 * a variável de ambiente diga o contrário), e qualquer valor que não seja
 * exatamente `producao` também vira homologação.
 */
export function resolveAmbiente(providerId: FiscalProviderId): FiscalAmbiente {
  if (providerId !== "focus-nfe") return "homologacao";
  return Deno.env.get("FISCAL_AMBIENTE")?.trim() === "producao" ? "producao" : "homologacao";
}

export function toArtifact(content: string | null, path: string | null, contentType: string): FiscalArtifact | null {
  if (!content && !path) return null;
  return { content, path, contentType };
}

/**
 * A nota que já está no banco, no formato que o provedor simulado sabe
 * restaurar.
 *
 * Existe porque o simulado guarda estado em memória e cada requisição desta
 * função pode cair num isolate novo: sem isto, cancelar uma nota emitida
 * ontem responderia `nao_encontrado` para um documento que está `autorizado`
 * no banco. Ver `seed` em `simulatedFiscalProvider.ts`.
 *
 * ## Uma reserva não é documento do provedor (A6, 09/09/2026)
 *
 * Uma linha em `processando_autorizacao` é **escrituração nossa**, feita antes
 * de o provedor ver a `ref`: ela não tem chave, número, protocolo nem XML.
 * Devolvê-la ao simulado o faria afirmar que se lembra de um documento que ele
 * nunca produziu — e, pior, a consulta de A6 responderia `processando_autorizacao`
 * para sempre, tornando a resolução de uma reserva órfã inalcançável justamente
 * no único provedor testável hoje.
 *
 * Sem semear, o simulado responde `nao_encontrado`, que é a verdade: o isolate
 * que emitiu morreu, e a memória dele morreu junto. É também o que um provedor
 * real responde para uma `ref` que nunca chegou a ele.
 *
 * O efeito colateral em `handleCancel` é benigno e foi conferido: cancelar uma
 * reserva passa a receber `nao_encontrado` em vez do 501 "cancelamento só é
 * possível para documento autorizado". As duas são recusas, as duas não gravam
 * nada, e nenhuma tela oferece o botão nesse estado (`canCancel` exige
 * `autorizado`).
 */
export function seedFromRow(row: FiscalDocumentRow): SimulatedFiscalProviderSeed["documents"] {
  if (row.status === RESERVA_STATUS) return [];
  return [
    {
      ref: row.ref,
      model: row.model,
      status: row.status as FiscalStatus,
      chave: row.chave,
      numero: row.numero,
      serie: row.serie,
      protocolo: row.protocolo,
      statusSefaz: row.status_sefaz,
      mensagemSefaz: row.mensagem_sefaz,
      xml: toArtifact(row.xml_content, row.xml_path, XML_CONTENT_TYPE),
      pdf: toArtifact(row.pdf_content, row.pdf_path, DANFE_CONTENT_TYPE),
      xmlCancelamento: null,
      qrCodeUrl: row.qr_code_url,
      cnpjEmitente: row.emitente_cnpj ?? "",
    },
  ];
}

/**
 * O que basta para falar com o provedor e reconciliar uma linha.
 *
 * Separado de `Context` porque a varredura de A7 **não tem usuário nem filial**:
 * ela roda sem sessão, por cima de todas as filiais, e um `branchId` inventado
 * ali seria pior que a ausência dele.
 */
export type ProviderContext = {
  admin: SupabaseClient;
  providerId: FiscalProviderId;
  ambiente: FiscalAmbiente;
};

/**
 * **Consulta o provedor pela `ref` e aplica `decideConsulta`** — o núcleo que
 * A6 escreveu, agora com dois chamadores.
 *
 * Extraído em A7 (09/09/2026) exatamente para que a varredura agendada **não
 * reimplemente decisão nenhuma**: ela chama isto, com `createdBy: null` e
 * `origemEscrita: "fila"`, e o que decide continua sendo a tabela de
 * `reservation.ts`. Fora daqui, a diferença entre o operador e a fila é só quem
 * assina o evento.
 *
 * `aplicado` é `false` num caso só: `liberar` cujo compare-and-swap não casou —
 * a linha saiu de `processando_autorizacao` entre a consulta e a escrita. Cada
 * chamador decide o que fazer com isso; nenhum deve tratá-lo como erro.
 */
export async function reconciliaComProvedor(
  ctx: ProviderContext,
  existing: FiscalDocumentRow,
  origem: string,
  autor: { createdBy: string | null; origemEscrita: OrigemReconciliacao },
): Promise<{ decisao: ConsultaDecisao; aplicado: boolean }> {
  const provider = createProvider(ctx, { documents: seedFromRow(existing) });
  const document = await provider.query(existing.ref);

  const decisao = decideConsulta(existing, document, origem);

  if (decisao.kind === "gravar") {
    await persistQueryStatus(ctx.admin, {
      documentId: existing.id,
      branchId: existing.branch_id,
      ambiente: ctx.ambiente,
      document,
      previousStatus: existing.status,
      createdBy: autor.createdBy,
      origem: autor.origemEscrita,
    });
    return { decisao, aplicado: true };
  }

  if (decisao.kind === "liberar") {
    const liberou = await releaseStuckReservation(ctx.admin, {
      documentId: existing.id,
      branchId: existing.branch_id,
      ambiente: ctx.ambiente,
      mensagem: decisao.mensagemSefaz,
      createdBy: autor.createdBy,
      origem: autor.origemEscrita,
    });
    return { decisao, aplicado: liberou };
  }

  return { decisao, aplicado: true };
}

export function createProvider(
  ctx: Pick<ProviderContext, "providerId">,
  seed: SimulatedFiscalProviderSeed,
): FiscalProvider {
  return createFiscalProvider(ctx.providerId, { simulatedSeed: seed });
}
