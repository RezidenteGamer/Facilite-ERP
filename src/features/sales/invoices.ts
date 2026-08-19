import type { FiscalArtifact } from "../../lib/fiscal/types";
import type { InvoiceDocument } from "../../lib/repositories/fiscalDocumentsRepository";

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatInvoiceTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const FISCAL_STATUS_LABEL: Record<InvoiceDocument["status"], string> = {
  autorizado: "Autorizado",
  processando_autorizacao: "Processando",
  erro_autorizacao: "Erro na emissão",
  denegado: "Denegado",
  cancelado: "Cancelado",
};

export function invoiceStatusLabel(document: InvoiceDocument | null): string {
  if (!document) return "Sem nota";
  return FISCAL_STATUS_LABEL[document.status];
}

export function invoiceStatusColor(document: InvoiceDocument | null): string {
  if (!document) return "var(--muted, #8a8a8a)";
  if (document.status === "autorizado") return "var(--positive)";
  if (document.status === "erro_autorizacao" || document.status === "denegado") return "var(--danger)";
  return "var(--muted, #8a8a8a)";
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
    const blob = new Blob([artifact.content], { type: artifact.contentType });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
