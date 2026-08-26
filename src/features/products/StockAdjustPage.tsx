import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import { RegistryActions, RegistryDetails, RegistryLayout, RegistryTable } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { normalizeSearchText } from "../../lib/searchText";
import { StockAdjustIcon } from "../home/icons";
import { buildDetailFields, buildTableColumns } from "../registry-engine/moduleView";
import RegistryBatchFormModal, {
  type BatchItem,
  type BatchRow,
} from "../registry-engine/RegistryBatchFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import { formatPrice, type Product } from "./products";
import { useProductsData } from "./useProductsData";
import { useStockAdjustmentsData } from "./useStockAdjustmentsData";
import type { StockAdjustment } from "../../lib/repositories/stockAdjustmentsRepository";

const MODULE_ID = "ajuste-estoque";

/** Produto -> item do lote. Clicar e arrastar precisam produzir o mesmo item. */
function toBatchItem(product: Product): BatchItem {
  return {
    id: product.id,
    label: `${product.code} — ${product.description}`,
    hint: `Estoque atual: ${product.stock}`,
  };
}

/** Campos de texto do formulário viram número aqui — o motor trata tudo como texto. */
function toBatchNumber(raw: string): number | null {
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Regra específica de Ajuste de estoque: cada linha informa a quantidade de um
 * jeito **ou** do outro. O motor genérico só sabe cobrar `isRequired`.
 */
function validateAdjustmentRow(values: Record<string, string>): string | null {
  const change = values.change?.trim() ?? "";
  const counted = values.countedBalance?.trim() ?? "";

  if (change === "" && counted === "") {
    return "informe a alteração (+/-) ou o saldo contado.";
  }
  if (change !== "" && counted !== "") {
    return "preencha só um dos dois — alteração (+/-) ou saldo contado.";
  }

  if (change !== "") {
    const parsed = toBatchNumber(change);
    if (parsed === null || parsed === 0) {
      return "a alteração precisa ser um número diferente de zero.";
    }
    return null;
  }

  const parsed = toBatchNumber(counted);
  if (parsed === null || parsed < 0) {
    return "o saldo contado precisa ser um número maior ou igual a zero.";
  }
  return null;
}

/**
 * Limpa "Saldo contado" ao digitar em "Alteração" e vice-versa — os dois são
 * jeitos alternativos de informar a mesma coisa, nunca os dois juntos. A
 * validação de submit (`validateAdjustmentRow`) continua sendo a rede de
 * segurança; isto é só a conveniência de não deixar o outro campo com um
 * valor que não vai ser usado.
 */
function clearOppositeQuantityField(
  _rowId: string,
  accessorKey: string,
  value: string,
): Record<string, string> | void {
  if (!value.trim()) return;
  if (accessorKey === "change") return { countedBalance: "" };
  if (accessorKey === "countedBalance") return { change: "" };
}

type ProductBatchPickerProps = {
  branchId: string | null;
  onPick: (item: BatchItem) => void;
};

/**
 * O "escolhedor de item" que este módulo entrega ao motor de lote. Fica aqui,
 * e não dentro do `RegistryBatchFormModal`, justamente porque saber procurar
 * produto é conhecimento de domínio — Compras/Devolução vão passar o seu.
 * O `DndContext` vem do motor: ele precisa envolver também a lista de destino.
 */
function ProductBatchPicker({ branchId, onPick }: ProductBatchPickerProps) {
  return (
    <ProductPickerPanel
      branchId={branchId}
      hint="Clique num produto ou arraste-o para a lista ao lado."
      onAddProduct={(product) => onPick(toBatchItem(product))}
    />
  );
}

function formatDateTime(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

/**
 * Módulo "Ajuste de estoque" — primeiro módulo de **lote** sobre o motor
 * genérico: a listagem/ficha vêm de `module_fields` como em Produtos, e a
 * criação usa o `RegistryBatchFormModal` para lançar vários produtos de uma
 * vez (contagem física de loja). Sem editar/excluir: é auditoria.
 */
export default function StockAdjustPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");

  const { definition, loading: definitionLoading, error: definitionError } = useModuleDefinition(MODULE_ID);
  const { adjustments, error: adjustmentsError, createAdjustmentBatch } =
    useStockAdjustmentsData(currentBranchId);
  // Só para resolver o `?produto=` de "Ajustar estoque de X" vindo de Realizar
  // Venda (estoque insuficiente) — a lista em si não aparece nesta tela.
  const { products, loading: productsLoading } = useProductsData(currentBranchId);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const preselectProductId = searchParams.get("produto");
  const preselectedProduct = useMemo(
    () => (preselectProductId ? (products.find((p) => p.id === preselectProductId) ?? null) : null),
    [preselectProductId, products],
  );

  // Abre o lote sozinho assim que os produtos carregarem — se o id não bater
  // com nenhum produto, abre do mesmo jeito, só sem pré-seleção (ver
  // `initialItems` abaixo).
  useEffect(() => {
    if (!preselectProductId || productsLoading) return;
    setModalOpen(true);
  }, [preselectProductId, productsLoading]);

  function closeModal() {
    setModalOpen(false);
    if (preselectProductId) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("produto");
          return next;
        },
        { replace: true },
      );
    }
  }

  useEffect(() => {
    openWindow({
      id: MODULE_ID,
      label: "Ajuste de estoque",
      path: "/ajuste-estoque",
      icon: StockAdjustIcon,
    });
  }, [openWindow]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && adjustments.some((adjustment) => adjustment.id === current)) return current;
      return adjustments[0]?.id ?? null;
    });
  }, [adjustments]);

  const visibleAdjustments = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return adjustments;
    return adjustments.filter(
      (adjustment) =>
        normalizeSearchText(adjustment.productDescription).includes(term) ||
        normalizeSearchText(adjustment.productCode).includes(term),
    );
  }, [adjustments, search]);

  const selected: StockAdjustment | null =
    visibleAdjustments.find((adjustment) => adjustment.id === selectedId) ?? null;

  const columns = useMemo(
    () => (definition ? buildTableColumns<StockAdjustment>(definition.fields) : []),
    [definition],
  );

  // O motor entrega tudo como texto cru; data e dinheiro ganham formato aqui,
  // mesmo caminho já usado em `ProductsPage`.
  const detailFields = useMemo(() => {
    if (!definition) return [];
    return buildDetailFields<StockAdjustment>(definition.fields, selected).map((field) => {
      if (!field.value) return field;
      if (field.label === "Data do ajuste") return { ...field, value: formatDateTime(field.value) };
      if (field.label === "Preço custo") return { ...field, value: formatPrice(Number(field.value)) };
      return field;
    });
  }, [definition, selected]);

  async function handleBatchSubmit(rows: BatchRow[]) {
    await createAdjustmentBatch(
      rows.map((row) => {
        const change = row.values.change?.trim() ?? "";
        const counted = row.values.countedBalance?.trim() ?? "";
        return {
          productId: row.item.id,
          change: change === "" ? undefined : (toBatchNumber(change) ?? undefined),
          countedBalance: counted === "" ? undefined : (toBatchNumber(counted) ?? undefined),
          reason: row.values.reason?.trim() ?? "",
        };
      }),
    );
    closeModal();
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (definitionError || adjustmentsError) {
    return (
      <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{definitionError ?? adjustmentsError}</p>
      </AppShell>
    );
  }

  if (definitionLoading && !definition) {
    return (
      <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Carregando módulo...</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para acessar este módulo.
        </p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver os ajustes."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
      <RegistryLayout>
        {/* Sem "Editar"/"Excluir": ajuste é registro de auditoria — apagar não
            desfaz a alteração de estoque. O conserto é um ajuste inverso. */}
        <RegistryActions
          title="Lançar um ajuste de estoque"
          actions={[
            {
              id: "ajuste",
              label: "Ajuste de estoque",
              disabled: !canCreate,
              onClick: () => setModalOpen(true),
            },
          ]}
        />

        <RegistryTable
          columns={columns}
          rows={visibleAdjustments}
          getRowId={(adjustment) => adjustment.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar produto"
          search={search}
          onSearchChange={setSearch}
          fields={detailFields}
          media={{ label: "Imagem", layout: "inline" }}
        />
      </RegistryLayout>

      {modalOpen && definition && (
        <RegistryBatchFormModal
          title="Ajuste de estoque"
          fields={definition.fields}
          emptyHint="Clique nos produtos ao lado — ou arraste-os para cá — para montar a lista de contagem. Em cada linha, informe a alteração (+/-) ou o saldo contado."
          submitLabel="Confirmar ajustes"
          validateRow={validateAdjustmentRow}
          onFieldChange={clearOppositeQuantityField}
          renderItemPicker={(onPick) => (
            <ProductBatchPicker branchId={currentBranchId} onPick={onPick} />
          )}
          // `ProductPickerPanel` põe o produto em `data: { product }` ao arrastar.
          resolveDraggedItem={(dragData) => {
            const product = dragData?.product as Product | undefined;
            return product ? toBatchItem(product) : null;
          }}
          initialItems={preselectedProduct ? [toBatchItem(preselectedProduct)] : undefined}
          onSubmit={handleBatchSubmit}
          onCancel={closeModal}
        />
      )}
    </AppShell>
  );
}
