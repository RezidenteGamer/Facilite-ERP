import { decodeArtifactContent, isBinaryArtifact } from "../../lib/fiscal/artifactContentTypes";
import type { FiscalArtifact } from "../../lib/fiscal/types";
import type { InvoiceDocument } from "../../lib/repositories/fiscalDocumentsRepository";

/** Formato monetário do sistema (pt-BR, com "R$" — mesmo padrão de `formatPrice` em Produtos). */
export function formatInvoiceTotal(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FISCAL_STATUS_LABEL: Record<InvoiceDocument["status"], string> = {
  autorizado: "Autorizado",
  processando_autorizacao: "Processando",
  erro_autorizacao: "Erro na emissão",
  denegado: "Denegado",
  cancelado: "Cancelado",
};

/**
 * Só o `status` importa para o rótulo — o parâmetro é a fatia mínima, e não o
 * `InvoiceDocument` inteiro, porque Devolução de venda mostra o status da nota
 * da venda original a partir de uma leitura enxuta (id/modelo/status/chave),
 * não do documento completo.
 */
export type FiscalStatusHolder = { status: InvoiceDocument["status"] };

export function invoiceStatusLabel(document: FiscalStatusHolder | null): string {
  if (!document) return "Sem nota";
  return FISCAL_STATUS_LABEL[document.status];
}

export function invoiceStatusColor(document: FiscalStatusHolder | null): string {
  if (!document) return "var(--muted, #8a8a8a)";
  if (document.status === "autorizado") return "var(--positive-soft)";
  if (document.status === "erro_autorizacao" || document.status === "denegado") return "var(--danger)";
  return "var(--muted, #8a8a8a)";
}

/**
 * Monta o `Blob` de um artefato — separado de `openFiscalArtifact` para poder
 * ser testado sem `window` (ver `tests/unit/fiscalArtifact.test.ts`).
 *
 * **O `decodeArtifactContent` aqui não é detalhe** (D13, 10/09/2026): desde que
 * o DANFE virou PDF, `content` chega em base64, e `new Blob([string])` gravaria
 * os caracteres da string base64 dentro de um arquivo rotulado
 * `application/pdf`. A tela não daria erro nenhum — a aba abriria, o arquivo
 * baixaria, e só um leitor de PDF descobriria o problema.
 */
export function fiscalArtifactBlob(artifact: FiscalArtifact & { content: string }): Blob {
  const decoded = decodeArtifactContent(artifact.content, artifact.contentType);
  // Tipo binário que mesmo assim voltou como string = o conteúdo não era
  // base64. Isso é o DANFE em HTML de uma nota emitida **antes de D13**, que a
  // leitura rotula como PDF porque a coluna `pdf_content` não distingue os
  // dois. Rotular esse `Blob` de `application/pdf` entregaria um "PDF" que
  // nenhum leitor abre; rotulado como HTML, ele abre como sempre abriu.
  const legado = isBinaryArtifact(artifact.contentType) && typeof decoded === "string";
  return new Blob([decoded], { type: legado ? "text/html" : artifact.contentType });
}

/**
 * Abre um artefato (DANFE/XML) numa aba nova — serve tanto `content`
 * (provedor simulado, gera localmente) quanto `path` (provedor real, guarda
 * no servidor dele). Sem esse helper único, a troca de provedor quebraria a
 * tela — é a antecipação que a decisão da etapa F1 já deixava pronta.
 */
export function openFiscalArtifact(artifact: FiscalArtifact | null): void {
  if (!artifact) return;
  if (artifact.path) {
    window.open(artifact.path, "_blank", "noopener,noreferrer");
    return;
  }
  if (artifact.content) {
    const url = URL.createObjectURL(fiscalArtifactBlob({ ...artifact, content: artifact.content }));
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
