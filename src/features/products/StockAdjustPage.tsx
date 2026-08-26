import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
  type RegistryTab,
} from "../../components/registry";
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
import { useStockMovementsData } from "./useStockMovementsData";
import type { StockAdjustment } from "../../lib/repositories/stockAdjustmentsRepository";
import {
  stockMovementLabel,
  type StockMovement,
} from "../../lib/repositories/stockMovementsRepository";

const MODULE_ID = "ajuste-estoque";

/**
 * As duas visões do módulo. "Movimentações" é o livro completo — venda,
 * compra, condicional, devolução e o próprio ajuste manual, tudo junto —
 * enquanto "Ajustes lançados" continua sendo só o histórico de
 * `stock_adjustments`, que é o que esta tela sempre mostrou.
 *
 * Aba, e não uma seção abaixo da lista: a tela já ocupa a altura toda em
 * três colunas (ações | tabela | ficha), e empilhar uma segunda tabela
 * dentro da coluna do meio deixaria as duas com metade da altura cada. As
 * duas listas respondem à mesma pergunta ("o que aconteceu com o estoque"),
 * em dois recortes — exatamente o caso de aba que Controle de caixa já usa.
 */
const TABS: RegistryTab[] = [
  { id: "ajustes", label: "Ajustes lançados" },
  { id: "movimentacoes", label: "Movimentações" },
];

type StockTab = (typeof TABS)[number]["id"];

/** Quantidade com até 3 casas, sem zeros à toa ("2" em vez de "2,000"). */
function formatMovementQuantity(value: number) {
  return Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}


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
 * Colunas do livro de movimentações. Fixas (e não vindas de `module_fields`
 * como as de "Ajustes lançados"): a fonte aqui é uma view que soma cinco
 * módulos diferentes, não uma tabela do motor genérico — não há metadado de
 * módulo para descrever.
 */
const MOVEMENT_COLUMNS: RegistryColumn<StockMovement>[] = [
  { key: "occurredAt", label: "Data", width: "150px", render: (m) => formatDateTime(m.occurredAt) },
  { key: "code", label: "Código", width: "90px", render: (m) => m.productCode },
  {
    key: "product",
    label: "Produto",
    width: "minmax(0, 1fr)",
    primary: true,
    render: (m) => m.productDescription,
  },
  {
    key: "movementType",
    label: "Tipo de movimento",
    width: "180px",
    render: (m) => stockMovementLabel(m.movementType),
  },
  { key: "originCode", label: "Origem", width: "130px", render: (m) => m.originCode },
  {
    key: "quantity",
    label: "Quantidade",
    width: "120px",
    align: "right",
    // Mesma convenção de cor/sinal do Financeiro: entrada em verde com "+",
    // saída em vermelho com "−" — dá para ver a direção num relance sem ler
    // a coluna de tipo.
    render: (m) => {
      const isOut = m.quantityDelta < 0;
      return (
        <span style={{ color: isOut ? "var(--danger)" : "var(--positive)", fontWeight: 600 }}>
          {isOut ? "−" : "+"} {formatMovementQuantity(m.quantityDelta)}
        </span>
      );
    },
  },
];

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
  // Livro completo (venda/compra/condicional/devolução/ajuste) da aba
  // "Movimentações" — só leitura, vem da view `stock_movements_view`.
  const {
    movements,
    loading: movementsLoading,
    loadingMore: movementsLoadingMore,
    hasMore: hasMoreMovements,
    error: movementsError,
    reload: reloadMovements,
    loadMore: loadMoreMovements,
  } = useStockMovementsData(currentBranchId);
  // Só para resolver o `?produto=` de "Ajustar estoque de X" vindo de Realizar
  // Venda (estoque insuficiente) — a lista em si não aparece nesta tela.
  const { products, loading: productsLoading } = useProductsData(currentBranchId);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movementId, setMovementId] = useState<string | null>(null);
  const [tab, setTab] = useState<StockTab>("ajustes");
  const [modalOpen, setModalOpen] = useState(false);

  const isMovements = tab === "movimentacoes";

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

  // Mesma busca da outra aba, mais o código de origem — procurar pela venda
  // "0031" é tão natural quanto procurar pelo produto neste livro.
  const visibleMovements = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return movements;
    return movements.filter(
      (movement) =>
        normalizeSearchText(movement.productDescription).includes(term) ||
        normalizeSearchText(movement.productCode).includes(term) ||
        normalizeSearchText(movement.originCode).includes(term),
    );
  }, [movements, search]);

  useEffect(() => {
    setMovementId((current) => {
      if (current && visibleMovements.some((movement) => movement.id === current)) return current;
      return visibleMovements[0]?.id ?? null;
    });
  }, [visibleMovements]);

  const selected: StockAdjustment | null =
    visibleAdjustments.find((adjustment) => adjustment.id === selectedId) ?? null;

  const selectedMovement: StockMovement | null =
    visibleMovements.find((movement) => movement.id === movementId) ?? null;

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

  /**
   * Ficha da aba "Movimentações". Fixa, pelo mesmo motivo das colunas: a
   * linha vem de uma view que soma cinco módulos, não de `module_fields`.
   */
  const movementDetailFields = useMemo(() => {
    if (!selectedMovement) {
      return [
        { label: "Data", value: "" },
        { label: "Produto", value: "" },
        { label: "Tipo de movimento", value: "" },
        { label: "Origem", value: "" },
        { label: "Quantidade", value: "" },
      ];
    }
    const isOut = selectedMovement.quantityDelta < 0;
    return [
      { label: "Data", value: formatDateTime(selectedMovement.occurredAt) },
      {
        label: "Produto",
        value: `${selectedMovement.productCode} — ${selectedMovement.productDescription}`,
      },
      { label: "Tipo de movimento", value: stockMovementLabel(selectedMovement.movementType) },
      { label: "Origem", value: selectedMovement.originCode },
      {
        label: "Quantidade",
        value: `${isOut ? "−" : "+"} ${formatMovementQuantity(selectedMovement.quantityDelta)}`,
      },
    ];
  }, [selectedMovement]);

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

        {isMovements ? (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={(id) => setTab(id as StockTab)}
            columns={MOVEMENT_COLUMNS}
            rows={visibleMovements}
            getRowId={(movement) => movement.id}
            selectedId={movementId}
            onSelect={setMovementId}
            // A view é paginada (ver `STOCK_MOVEMENTS_PAGE_SIZE`): o livro
            // cresce a cada venda/compra da filial e trazer tudo de uma vez
            // ficaria pesado com o tempo.
            footerActions={
              movementsError
                ? [{ id: "retry", label: "Tentar de novo", onClick: () => void reloadMovements() }]
                : hasMoreMovements
                  ? [
                      {
                        id: "mais",
                        label: movementsLoadingMore ? "Carregando..." : "Carregar mais",
                        disabled: movementsLoadingMore,
                        onClick: () => void loadMoreMovements(),
                      },
                    ]
                  : undefined
            }
          />
        ) : (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={(id) => setTab(id as StockTab)}
            columns={columns}
            rows={visibleAdjustments}
            getRowId={(adjustment) => adjustment.id}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {isMovements ? (
          <RegistryDetails
            searchLabel="Buscar produto ou origem"
            search={search}
            onSearchChange={setSearch}
            // Erro e carregamento aparecem na ficha, e não no lugar da
            // página inteira: a aba "Ajustes lançados" continua utilizável
            // mesmo se o livro falhar em carregar.
            fields={
              movementsError
                ? [{ label: "Erro ao carregar", value: movementsError }]
                : movementsLoading
                  ? [{ label: "Movimentações", value: "Carregando..." }]
                  : movementDetailFields
            }
          />
        ) : (
          <RegistryDetails
            searchLabel="Buscar produto"
            search={search}
            onSearchChange={setSearch}
            fields={detailFields}
            media={{ label: "Imagem", layout: "inline" }}
          />
        )}
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
