import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { InvoicesIcon } from "../home/icons";
import CancelInvoiceModal from "./CancelInvoiceModal";
import { formatInvoiceTotal, invoiceStatusColor, invoiceStatusLabel, openFiscalArtifact } from "./invoices";
import { extractErrorMessage, useInvoicesData } from "./useInvoicesData";
import type { InvoiceSaleRow } from "../../lib/repositories/fiscalDocumentsRepository";

const MODULE_ID = "notas-emitidas";

const COLUNAS: RegistryColumn<InvoiceSaleRow>[] = [
  { key: "code", label: "Código", width: "90px", align: "center", render: (n) => n.saleCode },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", primary: true, render: (n) => n.clientName },
  {
    key: "model",
    label: "Modelo",
    width: "80px",
    align: "center",
    // A lista traz NF-e e NFC-e juntas (etapa 8.5) — sem documento ainda,
    // não dá para saber qual modelo vai sair, então mostra "—".
    render: (n) => (n.document ? (n.document.model === "nfce" ? "NFC-e" : "NF-e") : "—"),
  },
  { key: "paymentMethod", label: "Forma de pagamento", width: "170px", render: (n) => n.paymentMethod },
  { key: "installments", label: "Parcelas", width: "100px", align: "center", render: (n) => n.installments },
  { key: "total", label: "Valor total", width: "120px", align: "center", render: (n) => formatInvoiceTotal(n.total) },
  {
    key: "status",
    label: "Status fiscal",
    width: "150px",
    render: (n) => (
      <span style={{ color: invoiceStatusColor(n.document), fontWeight: 600 }}>{invoiceStatusLabel(n.document)}</span>
    ),
  },
];

/**
 * Módulo "Notas emitidas" — etapa 8. Lista as vendas confirmadas da filial
 * (não só as que já têm nota, ao contrário do que o mock antigo sugeria): é
 * daqui que a emissão é disparada, escolhendo uma venda sem nota e emitindo
 * ("Emitir Nota", ação nova — o mock de 6 botões não tinha nenhuma ação de
 * emitir, só ações que pressupunham a nota já existir). Ver AGENTS.md para a
 * decisão completa.
 */
export default function InvoicesPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  const canEdit = hasPermission(MODULE_ID, "edit");

  const { sales, loading, error, emitInvoice, cancelInvoice, queryInvoice } = useInvoicesData(currentBranchId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emitting, setEmitting] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  useEffect(() => {
    openWindow({ id: "notas-emitidas", label: "Notas emitidas", path: "/notas-emitidas", icon: InvoicesIcon });
  }, [openWindow]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && sales.some((sale) => sale.saleId === current)) return current;
      return sales[0]?.saleId ?? null;
    });
  }, [sales]);

  const selected: InvoiceSaleRow | null = sales.find((sale) => sale.saleId === selectedId) ?? null;

  async function handleEmit() {
    if (!selected) return;
    setActionErrors([]);
    setActionMessage(null);
    setEmitting(true);
    try {
      const outcome = await emitInvoice(selected.saleId);
      if (outcome.ok) {
        setActionMessage("Nota autorizada com sucesso.");
      } else {
        setActionErrors(outcome.errors);
      }
    } catch (err) {
      setActionErrors([extractErrorMessage(err, "Não foi possível emitir a nota.")]);
    } finally {
      setEmitting(false);
    }
  }

  /**
   * "Consultar status" — o botão que A6 (09/09/2026) ligou à ação `query` da
   * Edge Function, que existia desde A1 sem nenhum chamador.
   *
   * Ele é a saída de uma nota presa em `processando_autorizacao`: a emissão
   * reserva a linha no banco antes de falar com o provedor (A5), e um isolate
   * morto no meio — por limite de CPU, de memória ou por uma implantação —
   * deixa a reserva pendurada, sem nada que a limpe. `handleEmit` recusa
   * reemitir por cima dela, de propósito.
   *
   * O que a consulta faz **não** é liberar a reserva: é perguntar ao provedor,
   * pela `ref`, o que ele sabe. Se ele já autorizou, o resultado dele é gravado
   * (a nota não estava perdida — só a resposta não chegou a ser gravada); se
   * ele não conhece a nota, aí sim a venda é liberada para nova emissão.
   * Liberar sem perguntar criaria uma segunda nota real para a mesma venda.
   */
  async function handleQuery() {
    if (!selected) return;
    setActionErrors([]);
    setActionMessage(null);
    setQuerying(true);
    try {
      const outcome = await queryInvoice(selected.saleId);
      if (outcome.ok) {
        setActionMessage(outcome.mensagem ?? "Consulta concluída.");
      } else {
        setActionErrors(outcome.errors);
      }
    } catch (err) {
      setActionErrors([extractErrorMessage(err, "Não foi possível consultar o status da nota.")]);
    } finally {
      setQuerying(false);
    }
  }

  async function handleCancel(justificativa: string) {
    if (!selected?.document) return;
    await cancelInvoice(selected.saleId, justificativa);
    setActionMessage("Nota cancelada.");
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Notas fiscais emitidas" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Notas fiscais emitidas" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Notas fiscais emitidas" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver as notas emitidas."}
        </p>
      </AppShell>
    );
  }

  const document = selected?.document ?? null;
  const canCancel = Boolean(document && document.status === "autorizado" && canEdit);

  /**
   * A consulta só faz sentido nos estados em que o banco pode estar
   * desatualizado em relação ao provedor: a reserva que pode ter ficado órfã, e
   * a recusa que pode ter sido revertida do lado dele. Uma nota `autorizado` ou
   * `cancelado` já tem desfecho gravado, e consultar não mudaria nada
   * (`decideConsulta` protege o cancelamento explicitamente).
   *
   * A permissão é a de leitura — a ação `query` pede `view` na Edge Function, e
   * quem chegou nesta tela já a tem.
   */
  const canQuery = Boolean(
    document &&
      (document.status === "processando_autorizacao" ||
        document.status === "erro_autorizacao" ||
        document.status === "denegado"),
  );

  return (
    <AppShell navItems={navItems} secondaryText="Notas fiscais emitidas" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Notas emitidas"
          columns={COLUNAS}
          rows={sales}
          getRowId={(sale) => sale.saleId}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setActionErrors([]);
            setActionMessage(null);
          }}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          fieldsTitle={selected ? `Venda ${selected.saleCode}` : undefined}
          fields={
            document
              ? [
                  { label: "Modelo", value: document.model === "nfce" ? "NFC-e" : "NF-e" },
                  { label: "Chave de acesso", value: document.chave ?? "—" },
                  { label: "Protocolo", value: document.protocolo ?? "—" },
                  ...(document.qrCodeUrl ? [{ label: "QR Code", value: document.qrCodeUrl }] : []),
                  { label: "Mensagem da SEFAZ", value: document.mensagemSefaz ?? "—" },
                ]
              : selected
                ? [{ label: "Status", value: "Sem nota emitida" }]
                : []
          }
          actions={[
            {
              id: "emitir",
              label: loading ? "Carregando..." : emitting ? "Emitindo..." : "Emitir Nota",
              disabled: !selected || !canCreate || emitting || querying || loading,
              onClick: handleEmit,
            },
            {
              id: "consultar-status",
              label: querying ? "Consultando..." : "Consultar status",
              disabled: !canQuery || querying || emitting || loading,
              onClick: handleQuery,
            },
            {
              id: "visualizar",
              label: "Visualizar",
              disabled: !document?.pdf,
              onClick: () => openFiscalArtifact(document?.pdf ?? null),
            },
            {
              id: "gerar-xml",
              label: "Gerar XML",
              disabled: !document?.xml,
              onClick: () => openFiscalArtifact(document?.xml ?? null),
            },
            // CC-e é um evento que o FiscalProvider (etapa F1) não cobre — mexer
            // nisso seria redesenhar a interface, fora de escopo desta etapa.
            { id: "carta-de-correcao", label: "Carta de correção", disabled: true },
            {
              id: "financeiro",
              label: "Financeiro",
              disabled: !selected,
              // A venda já gera o lançamento na confirmação (create_sale, etapa
              // 3.5) — emitir nota não deve gerar lançamento nenhum. Este botão
              // só navega até o módulo; não há filtro por venda no Financeiro
              // hoje, então quem for conferir busca pelo documento ("Venda 000X").
              onClick: () => navigate("/financeiro"),
            },
            // Sem especificação — mesma decisão de Pedidos de venda/Compras.
            { id: "trocar", label: "Trocar", disabled: true },
            {
              id: "cancelar",
              label: "Cancelar",
              disabled: !canCancel,
              tone: "danger",
              onClick: () => setCancelModalOpen(true),
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
      {actionMessage && !actionErrors.length && (
        <p style={{ color: "var(--positive)", padding: "0 24px" }}>{actionMessage}</p>
      )}

      {cancelModalOpen && selected && (
        <CancelInvoiceModal
          saleCode={selected.saleCode}
          onSubmit={handleCancel}
          onDone={() => setCancelModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
