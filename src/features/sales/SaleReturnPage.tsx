import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import {
  fetchReturnableSaleDetail,
  fetchSaleReturnDocument,
  type ReturnableSaleDetail,
} from "../../lib/repositories/saleReturnsRepository";
import type { InvoiceDocument } from "../../lib/repositories/fiscalDocumentsRepository";
import { useAuth } from "../auth/AuthContext";
import { normalizeSearchText } from "../../lib/searchText";
import { SaleReturnIcon } from "../home/icons";
import CancelInvoiceModal from "./CancelInvoiceModal";
import { invoiceStatusLabel, openFiscalArtifact } from "./invoices";
import SaleReturnModal from "./SaleReturnModal";
import { formatReturnDate, formatReturnTotal, saleReturnStatusLabel, type SaleReturn } from "./saleReturns";
import { useSaleReturnsData, type FiscalOutcome } from "./useSaleReturnsData";

const MODULE_ID = "devolucao-venda";

const COLUNAS: RegistryColumn<SaleReturn>[] = [
  { key: "code", label: "Código", width: "90px", align: "center", render: (r) => r.code },
  { key: "saleCode", label: "Venda", width: "90px", align: "center", render: (r) => r.saleCode },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", primary: true, render: (r) => r.clientName },
  { key: "issueDate", label: "Data", width: "110px", align: "center", render: (r) => formatReturnDate(r.issueDate) },
  { key: "items", label: "Itens", width: "80px", align: "center", render: (r) => r.itemCount },
  { key: "status", label: "Situação", width: "110px", align: "center", render: (r) => saleReturnStatusLabel(r.status) },
  { key: "total", label: "Valor devolvido", width: "150px", render: (r) => formatReturnTotal(r.total) },
  { key: "operator", label: "Operador", width: "140px", align: "right", render: (r) => r.operatorName },
];

/**
 * Módulo "Devolução de venda" (etapa 9).
 *
 * A tela é a lista das devoluções da filial. "Devolver venda" abre o modal de
 * criação (venda de origem → itens/quantidades → motivo), que grava estoque e
 * financeiro **atomicamente** pela RPC.
 *
 * ## As duas opções fiscais, oferecidas — não decididas por decreto
 *
 * Depois de a devolução estar gravada, a parte fiscal é um passo **seguinte e
 * não bloqueante**, com dois caminhos que a tela oferece lado a lado:
 *
 * - **Cancelar a nota da venda** — quando a nota original ainda está
 *   `autorizado` e o operador julga estar dentro do prazo legal.
 * - **Emitir nota de devolução** — NF-e de entrada com CFOP de devolução,
 *   referenciando a nota original.
 *
 * **O sistema não calcula o prazo de cancelamento.** A regra varia por UF e
 * por modelo (perto de 24h na maioria dos casos, mas não é universal), e uma
 * data errada aqui é risco fiscal real — errar para o lado do "ainda dá" faria
 * o sistema sugerir um cancelamento que a SEFAZ vai recusar, e errar para o
 * outro esconderia o caminho certo. Quem decide é o operador; os dois botões
 * ficam habilitados enquanto fizerem sentido tecnicamente.
 */
export default function SaleReturnPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  // A parte fiscal grava em `fiscal_documents`, cuja RLS é gated por
  // `notas-emitidas` (emitir = create, cancelar = edit) — não por este módulo.
  // Mesma pegadinha de permissão já documentada no PDV: um papel que faz
  // devolução com nota precisa das permissões dos dois módulos.
  const canEmit = hasPermission("notas-emitidas", "create");
  const canCancelInvoice = hasPermission("notas-emitidas", "edit");

  const { returns, loading, error, createReturn, emitReturnInvoice, cancelOriginalInvoice } =
    useSaleReturnsData(currentBranchId);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /** Detalhe do registro selecionado: a nota da venda original e a nota da devolução. */
  const [originSale, setOriginSale] = useState<ReturnableSaleDetail | null>(null);
  const [returnDocument, setReturnDocument] = useState<InvoiceDocument | null>(null);

  useEffect(() => {
    openWindow({
      id: "devolucao-venda",
      label: "Devolução de venda",
      path: "/devolucao-venda",
      icon: SaleReturnIcon,
    });
  }, [openWindow]);

  const visibleReturns = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return returns;
    return returns.filter(
      (item) =>
        normalizeSearchText(item.clientName).includes(term) ||
        normalizeSearchText(item.code).includes(term) ||
        normalizeSearchText(item.saleCode).includes(term),
    );
  }, [returns, search]);

  const selected: SaleReturn | null = visibleReturns.find((r) => r.id === selectedId) ?? null;

  // Carrega o contexto fiscal do registro selecionado (nota da venda + nota da
  // devolução) fora da lista: só o selecionado precisa, e um join a mais na
  // listagem inteira pagaria por linhas que ninguém abre.
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setOriginSale(null);
      setReturnDocument(null);
      return;
    }
    Promise.all([fetchReturnableSaleDetail(selected.saleId), fetchSaleReturnDocument(selected.id)])
      .then(([sale, document]) => {
        if (cancelled) return;
        setOriginSale(sale);
        setReturnDocument(document);
      })
      .catch(() => {
        if (cancelled) return;
        setOriginSale(null);
        setReturnDocument(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function showOutcome(outcome: FiscalOutcome) {
    if (outcome.ok) {
      setActionMessage(outcome.message);
      setActionErrors([]);
    } else {
      setActionMessage(null);
      setActionErrors(outcome.errors);
    }
  }

  async function handleEmitReturnInvoice() {
    if (!selected) return;
    setBusy(true);
    try {
      showOutcome(await emitReturnInvoice(selected.id));
      setReturnDocument(await fetchSaleReturnDocument(selected.id));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOriginal(justificativa: string) {
    if (!selected || !originSale?.invoice) return;
    const outcome = await cancelOriginalInvoice(originSale.invoice.id, selected.saleId, justificativa);
    showOutcome(outcome);
    // O modal só fecha sozinho quando dá certo — recusa da SEFAZ (justificativa
    // curta, evento duplicado) precisa aparecer dentro dele, não sumir junto.
    if (!outcome.ok) throw new Error(outcome.errors[0]);
    setOriginSale(await fetchReturnableSaleDetail(selected.saleId));
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Devolução de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Devolução de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Devolução de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : 'Selecione uma filial no menu "Filiais" para ver as devoluções.'}
        </p>
      </AppShell>
    );
  }

  const originInvoice = originSale?.invoice ?? null;
  const canCancelOriginal = Boolean(selected && originInvoice?.status === "autorizado" && canCancelInvoice && !busy);
  const canEmitReturn = Boolean(selected && canEmit && !busy && returnDocument?.status !== "autorizado");

  return (
    <AppShell navItems={navItems} secondaryText="Devolução de venda" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Devoluções de venda"
          columns={COLUNAS}
          rows={visibleReturns}
          getRowId={(item) => item.id}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setActionErrors([]);
            setActionMessage(null);
          }}
        />

        <RegistryActions
          search={{ label: "Buscar devolução", value: search, onChange: setSearch, showLabel: true }}
          fieldsTitle={selected ? `Devolução ${selected.code}` : undefined}
          fields={
            selected
              ? [
                  { label: "Venda de origem", value: selected.saleCode },
                  { label: "Data", value: formatReturnDate(selected.issueDate) },
                  { label: "Motivo", value: selected.reason || "—" },
                  {
                    label: "Nota da venda",
                    value: originInvoice
                      ? `${originInvoice.model === "nfce" ? "NFC-e" : "NF-e"} — ${invoiceStatusLabel(originInvoice)}`
                      : "Sem nota",
                  },
                  { label: "Nota de devolução", value: invoiceStatusLabel(returnDocument) },
                  ...(returnDocument?.chave ? [{ label: "Chave da devolução", value: returnDocument.chave }] : []),
                  ...(returnDocument?.mensagemSefaz
                    ? [{ label: "Mensagem da SEFAZ", value: returnDocument.mensagemSefaz }]
                    : []),
                ]
              : []
          }
          actionsTitle="Opções para vendas"
          actions={[
            {
              id: "devolver-venda",
              label: loading ? "Carregando..." : "Devolver venda",
              disabled: !canCreate || loading || busy,
              onClick: () => {
                setActionErrors([]);
                setActionMessage(null);
                setCreateOpen(true);
              },
            },
            {
              id: "emitir-nota-devolucao",
              label: busy ? "Processando..." : "Emitir nota de devolução",
              disabled: !canEmitReturn,
              onClick: handleEmitReturnInvoice,
            },
            {
              id: "visualizar",
              label: "Visualizar",
              disabled: !returnDocument?.pdf,
              onClick: () => openFiscalArtifact(returnDocument?.pdf ?? null),
            },
            {
              id: "gerar-xml",
              label: "Gerar XML",
              disabled: !returnDocument?.xml,
              onClick: () => openFiscalArtifact(returnDocument?.xml ?? null),
            },
            {
              id: "financeiro",
              // A devolução já gerou o "a pagar" na confirmação — este botão só
              // navega. Não há filtro por origem no Financeiro hoje; quem for
              // conferir localiza pelo documento ("Devolução 000X"). Mesma
              // decisão consciente já registrada em Notas Emitidas.
              label: "Financeiro",
              disabled: !selected,
              onClick: () => navigate("/financeiro"),
            },
            {
              id: "cancelar-nota-venda",
              label: "Cancelar nota da venda",
              disabled: !canCancelOriginal,
              tone: "danger",
              detached: true,
              onClick: () => {
                setActionErrors([]);
                setActionMessage(null);
                setCancelOpen(true);
              },
            },
          ]}
        />
      </RegistryLayout>

      {actionErrors.length > 0 && (
        <div style={{ padding: "0 24px" }}>
          {actionErrors.map((message, index) => (
            <p key={index} style={{ color: "var(--danger)", margin: "4px 0" }}>
              {message}
            </p>
          ))}
        </div>
      )}
      {actionMessage && actionErrors.length === 0 && (
        <p style={{ color: "var(--positive)", padding: "0 24px" }}>{actionMessage}</p>
      )}

      {createOpen && currentBranchId && (
        <SaleReturnModal
          branchId={currentBranchId}
          onSubmit={async (input) => {
            const id = await createReturn(input);
            setSelectedId(id);
            setActionMessage(
              "Devolução registrada: estoque reposto e lançamento a pagar criado no Financeiro. " +
                "A parte fiscal é o passo seguinte — cancele a nota da venda ou emita a nota de devolução.",
            );
          }}
          onDone={() => setCreateOpen(false)}
        />
      )}

      {cancelOpen && selected && (
        <CancelInvoiceModal
          saleCode={selected.saleCode}
          onSubmit={handleCancelOriginal}
          onDone={() => setCancelOpen(false)}
        />
      )}
    </AppShell>
  );
}
