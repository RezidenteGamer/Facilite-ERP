import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { extractErrorMessage } from "../../lib/errorMessage";
import { normalizeSearchText } from "../../lib/searchText";
import { useAuth } from "../auth/AuthContext";
import BranchFormModal from "./BranchFormModal";
import {
  branchFormValuesFrom,
  regimeTributarioLabel,
  type BranchAdmin,
  type BranchFormValues,
} from "./branches";
import { useBranchesAdmin } from "./useBranchesAdmin";

const COLUNAS: RegistryColumn<BranchAdmin>[] = [
  { key: "code", label: "Código", width: "90px", align: "center", render: (b) => b.code },
  { key: "name", label: "Nome", width: "minmax(0, 1fr)", primary: true, render: (b) => b.name },
  { key: "cnpj", label: "CNPJ", width: "170px", render: (b) => b.cnpj ?? "—" },
  { key: "uf", label: "UF", width: "60px", align: "center", render: (b) => b.uf ?? "—" },
  {
    key: "active",
    label: "Situação",
    width: "100px",
    align: "center",
    render: (b) => (b.active ? "Ativa" : "Inativa"),
  },
];

type ModalState = "none" | "new" | "edit";

/** Endereço em uma linha, do jeito que a ficha mostra. */
function enderecoResumido(branch: BranchAdmin): string {
  const rua = [branch.logradouro, branch.numero].filter(Boolean).join(", ");
  const cidade = [branch.municipio, branch.uf].filter(Boolean).join(" / ");
  const partes = [rua, branch.bairro, cidade, branch.cep].filter(Boolean);
  return partes.length > 0 ? partes.join(" — ") : "Não informado";
}

/**
 * Cadastro de filiais (D1, 09/09/2026) — a tela que fecha "hoje filial só se
 * cria por SQL", a lacuna mais antiga do projeto (registrada desde a decisão
 * de multiempresa, em 13/08/2026).
 *
 * **Tela própria, e não `GenericModulePage`.** O motivo está por extenso na
 * entrada de D1 no AGENTS.md; o resumo é o portão: o motor genérico decide
 * "pode criar/editar/excluir" por `has_permission(module_id, ação)`, e a RLS de
 * `branches` decide por `can_manage_branches()`. Ligar um ao outro exigiria ou
 * afrouxar a RLS da tabela que ancora `has_branch_access` para as 12 tabelas
 * isoladas por filial, ou semear linhas em `role_permissions` que o banco
 * ignora — uma UI prometendo o que o banco recusa.
 *
 * **Não há "Excluir" de propósito.** A policy `manage branches delete` existe,
 * mas apagar uma filial deixa órfã toda linha operacional que aponta para ela
 * (produtos, vendas, notas emitidas, financeiro). Desativar é a operação que
 * o cadastro precisa; apagar de verdade continua sendo assunto de SQL
 * deliberado, não de um botão ao lado de "Editar".
 *
 * **Rota**: `/configuracoes/filiais`, sub-rota do módulo `configuracoes`
 * (mesmo mecanismo de `/compras/nova`). Uma entrada nova no catálogo `modules`
 * seria um `insert` — uma migration —, e esta sessão não pode aplicar
 * migrations: a tela nasceria inalcançável, justamente a que A11 precisa
 * alcançar. Promovê-la a módulo de primeiro nível depois é uma linha de SQL.
 */
export default function BranchesAdminPage() {
  const navigate = useNavigate();
  const { profile, refreshBranches } = useAuth();
  const canManage = Boolean(profile?.canManageBranches);

  const { branches, loading, error, emailColumnAvailable, create, update } =
    useBranchesAdmin(canManage);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>("none");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleBranches = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return branches;
    return branches.filter(
      (branch) =>
        normalizeSearchText(branch.name).includes(term) ||
        normalizeSearchText(branch.code).includes(term) ||
        normalizeSearchText(branch.cnpj ?? "").includes(term),
    );
  }, [branches, search]);

  /* A seleção segue a lista em vez de morar num efeito: se a filial escolhida
     sumiu do filtro (ou da lista, depois de salvar), cai na primeira. */
  const selected: BranchAdmin | null =
    visibleBranches.find((branch) => branch.id === selectedId) ?? visibleBranches[0] ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  async function salvar(values: BranchFormValues) {
    setSaving(true);
    setActionError(null);
    try {
      if (modal === "edit") {
        if (!selected) return;
        await update(selected.id, values);
      } else {
        await create(values);
      }
      /* O seletor de filial e a faixa do cabeçalho leem a lista que o
         AuthContext carregou na sessão — sem isto, renomear a filial ativa
         só apareceria no próximo F5. */
      await refreshBranches();
      setModal("none");
    } catch (err) {
      setActionError(extractErrorMessage(err, "Erro ao salvar a filial."));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <AppShell navItems={navItems} secondaryText="Filiais" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para gerenciar filiais.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Filiais" contentTone="blue" fillViewport>
      {(error || actionError) && (
        <p style={{ color: "var(--danger)", padding: "12px 24px 0" }} role="alert">
          {error ?? actionError}
        </p>
      )}

      <RegistryLayout>
        <RegistryActions
          title="Cadastrar uma nova filial"
          actions={[
            {
              id: "nova",
              label: "Nova filial",
              tone: "positive" as const,
              onClick: () => setModal("new"),
            },
            {
              id: "editar",
              label: "Editar",
              disabled: !selected,
              onClick: () => setModal("edit"),
            },
            {
              id: "voltar-configuracoes",
              label: "Configurações",
              onClick: () => navigate("/configuracoes"),
            },
          ]}
        />

        <RegistryTable
          columns={COLUNAS}
          rows={visibleBranches}
          getRowId={(branch) => branch.id}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          minRows={6}
        />

        <RegistryDetails
          searchLabel="Buscar filial"
          search={search}
          onSearchChange={setSearch}
          fields={[
            { label: "Situação", value: selected ? (selected.active ? "Ativa" : "Inativa") : undefined },
            { label: "Regime tributário", value: selected ? regimeTributarioLabel(selected.regimeTributario) : undefined },
            { label: "Inscrição estadual", value: selected?.inscricaoEstadual ?? "Não informada" },
            { label: "CNAE fiscal", value: selected?.cnae ?? "Não informado" },
            { label: "Código IBGE do município", value: selected?.codigoIbgeMunicipio ?? "Não informado" },
            { label: "Endereço", value: selected ? enderecoResumido(selected) : undefined },
            {
              label: "Estoque negativo",
              value: selected ? (selected.allowNegativeStock ? "Permitido" : "Bloqueado") : undefined,
            },
            {
              label: "E-mail para cópia da nota",
              /* Como todas as outras linhas: sem filial selecionada, sem
                 valor. Afirmar "Indisponível" com a ficha vazia soaria como
                 um fato sobre uma filial que não está na tela. */
              value: !selected
                ? undefined
                : emailColumnAvailable === false
                  ? "Indisponível (migration de D1 não aplicada)"
                  : (selected.emailCopiaNotaFiscal ?? "Não informado"),
            },
          ]}
        />
      </RegistryLayout>

      {loading && <p style={{ color: "var(--white)", padding: "0 24px" }}>Carregando filiais…</p>}

      {/* Metade do cadastro de filiais continua fora daqui, e dizer isso na
          tela é melhor que o operador descobrir criando uma filial que
          ninguém consegue selecionar. */}
      <p style={{ color: "var(--white)", opacity: 0.72, fontSize: 13, padding: "0 24px 16px", lineHeight: 1.5 }}>
        Vincular usuários a filiais (<code>user_branches</code>) ainda é feito por SQL — uma filial
        recém-criada não aparece no seletor de ninguém até esse vínculo existir.
      </p>

      {modal !== "none" && (
        <BranchFormModal
          title={modal === "edit" ? `Editar filial — ${selected?.name ?? ""}` : "Nova filial"}
          initialValues={modal === "edit" && selected ? branchFormValuesFrom(selected) : undefined}
          emailColumnAvailable={emailColumnAvailable}
          saving={saving}
          onSubmit={salvar}
          onCancel={() => setModal("none")}
        />
      )}
    </AppShell>
  );
}
