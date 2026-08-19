import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryDetails, RegistryLayout, RegistryTable } from "../../components/registry";
import { fetchTaxGroups } from "../../lib/repositories/taxGroupLookups";
import type { TaxGroup } from "../../lib/fiscal/taxGroups";
import { useAuth } from "../auth/AuthContext";
import { buildDetailFields, buildFormFields, buildTableColumns } from "../registry-engine/moduleView";
import RegistryFormModal from "../registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import { ProductsIcon } from "../home/icons";
import { buildProductInput, formatPrice, type Product } from "./products";
import { useProductsData } from "./useProductsData";

const MODULE_ID = "produtos";

type ModalState = "none" | "new" | "edit" | "clone";

/** O que o formulário precisa saber do grupo escolhido: o id que ele grava e o nome que ele mostra. */
type SelectedTaxGroup = { id: string; name: string };

/** Módulo "Produtos" — segundo módulo sobre o motor genérico de metadados, isolado por filial. */
export default function ProductsPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  const canEdit = hasPermission(MODULE_ID, "edit");
  const canDelete = hasPermission(MODULE_ID, "delete");

  const { definition, loading: definitionLoading, error: definitionError } = useModuleDefinition(MODULE_ID);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>("none");
  const [formTaxGroup, setFormTaxGroup] = useState<SelectedTaxGroup | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const {
    products,
    error: productsError,
    createProduct,
    updateProduct,
    deleteProduct,
  } = useProductsData(currentBranchId);

  useEffect(() => {
    openWindow({
      id: "produtos",
      label: "Produtos",
      path: "/produtos",
      icon: ProductsIcon,
    });
  }, [openWindow]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && products.some((product) => product.id === current)) return current;
      return products[0]?.id ?? null;
    });
  }, [products]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.description.toLowerCase().includes(term) || product.code.toLowerCase().includes(term),
    );
  }, [products, search]);

  const selected: Product | null = visibleProducts.find((product) => product.id === selectedId) ?? null;

  const columns = useMemo(
    () => (definition ? buildTableColumns<Product>(definition.fields) : []),
    [definition],
  );
  const detailFields = useMemo(() => {
    if (!definition) return [];
    const fields = buildDetailFields<Product>(definition.fields, selected);
    return fields.map((field) =>
      (field.label === "Preço custo" || field.label === "Preço Atacado") && field.value
        ? { ...field, value: formatPrice(Number(field.value)) }
        : field,
    );
  }, [definition, selected]);
  const formFields = useMemo(() => (definition ? buildFormFields(definition.fields) : []), [definition]);

  async function toggleActive() {
    if (!selected) return;
    await updateProduct(selected.id, { active: !selected.active });
  }

  /** Abre o formulário já com o grupo do produto selecionado (ou vazio, em "Novo"). */
  function openModal(next: Exclude<ModalState, "none">) {
    const source = next === "new" ? null : selected;
    setFormTaxGroup(
      source?.taxGroupId ? { id: source.taxGroupId, name: source.taxGroupName ?? "" } : null,
    );
    setModal(next);
  }

  async function handleCreateSubmit(values: Record<string, string>) {
    await createProduct(buildProductInput(values, formTaxGroup?.id ?? null));
    setModal("none");
  }

  async function handleEditSubmit(values: Record<string, string>) {
    if (!selected) return;
    await updateProduct(selected.id, buildProductInput(values, formTaxGroup?.id ?? null));
    setModal("none");
  }

  /**
   * O grupo tributário entra pelo `lookupField` do `RegistryFormModal` — o
   * mesmo prop de ponte que o Financeiro usa para o contato. `module_fields`
   * continua sem um `data_type: 'lookup'`: criar um generalizaria o motor
   * inteiro por causa de um campo (mesma disciplina já registrada lá).
   */
  const taxGroupLookup = {
    label: "Grupo tributário",
    value: formTaxGroup?.name ?? "",
    modalTitle: "Selecionar grupo tributário",
    searchPlaceholder: "Buscar por código ou nome...",
    fetchItems: fetchTaxGroups,
    getKey: (group: TaxGroup) => group.id,
    renderItem: (group: TaxGroup) => ({ primary: group.name, secondary: group.code }),
    onSelect: (group: TaxGroup) => setFormTaxGroup({ id: group.id, name: group.name }),
  };

  async function handleConfirmDelete() {
    if (!confirmingDeleteId) return;
    await deleteProduct(confirmingDeleteId);
    setConfirmingDeleteId(null);
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (definitionError || productsError) {
    return (
      <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{definitionError ?? productsError}</p>
      </AppShell>
    );
  }

  if (definitionLoading && !definition) {
    return (
      <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Carregando módulo...</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para acessar este módulo.
        </p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver os produtos."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title="Cadastrar um novo produto"
          actions={[
            { id: "novo", label: "Novo produto", disabled: !canCreate, onClick: () => openModal("new") },
            { id: "editar", label: "Editar", disabled: !selected || !canEdit, onClick: () => openModal("edit") },
            { id: "clonar", label: "Clonar", disabled: !selected || !canCreate, onClick: () => openModal("clone") },
            {
              id: "excluir",
              label: "Excluir",
              disabled: !selected || !canDelete,
              detached: true,
              onClick: () => selected && setConfirmingDeleteId(selected.id),
            },
          ]}
        />

        <RegistryTable
          columns={columns}
          rows={visibleProducts}
          getRowId={(product) => product.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar produto"
          search={search}
          onSearchChange={setSearch}
          status={{
            active: Boolean(selected?.active),
            disabled: !selected || !canEdit,
            onToggle: toggleActive,
          }}
          fields={detailFields}
          media={{ label: "Imagem", layout: "inline" }}
        />
      </RegistryLayout>

      {modal === "new" && (
        <RegistryFormModal<TaxGroup>
          title="Novo produto"
          fields={formFields}
          lookupField={taxGroupLookup}
          onSubmit={handleCreateSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {modal === "edit" && selected && (
        <RegistryFormModal<TaxGroup>
          title="Editar produto"
          fields={formFields}
          lookupField={taxGroupLookup}
          initialValues={{
            description: selected.description,
            stock: String(selected.stock),
            salePrice: String(selected.salePrice),
            taxation: selected.taxation ?? "",
            type: selected.type ?? "",
            costPrice: selected.costPrice !== undefined ? String(selected.costPrice) : "",
            wholesalePrice: selected.wholesalePrice !== undefined ? String(selected.wholesalePrice) : "",
            ncm: selected.ncm ?? "",
            location: selected.location ?? "",
            subLocation: selected.subLocation ?? "",
            cest: selected.cest ?? "",
            origemMercadoria: selected.origemMercadoria ?? "",
            unidadeComercial: selected.unidadeComercial ?? "",
            unidadeTributavel: selected.unidadeTributavel ?? "",
            cstIpi: selected.cstIpi ?? "",
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {modal === "clone" && selected && (
        <RegistryFormModal<TaxGroup>
          title="Clonar produto"
          fields={formFields}
          lookupField={taxGroupLookup}
          initialValues={{
            description: selected.description,
            stock: String(selected.stock),
            salePrice: String(selected.salePrice),
            taxation: selected.taxation ?? "",
            type: selected.type ?? "",
            costPrice: selected.costPrice !== undefined ? String(selected.costPrice) : "",
            wholesalePrice: selected.wholesalePrice !== undefined ? String(selected.wholesalePrice) : "",
            ncm: selected.ncm ?? "",
            location: selected.location ?? "",
            subLocation: selected.subLocation ?? "",
            cest: selected.cest ?? "",
            origemMercadoria: selected.origemMercadoria ?? "",
            unidadeComercial: selected.unidadeComercial ?? "",
            unidadeTributavel: selected.unidadeTributavel ?? "",
            cstIpi: selected.cstIpi ?? "",
          }}
          submitLabel="Clonar"
          onSubmit={handleCreateSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {confirmingDeleteId && (
        <ConfirmDialog
          title="Excluir produto?"
          message="Essa ação não pode ser desfeita."
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDeleteId(null)}
        />
      )}
    </AppShell>
  );
}
