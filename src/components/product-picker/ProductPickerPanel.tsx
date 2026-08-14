import { useDraggable } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { PencilIcon, SearchIcon } from "../icons";
import { useAuth } from "../../features/auth/AuthContext";
import { buildFormFields } from "../../features/registry-engine/moduleView";
import RegistryFormModal from "../../features/registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../../features/registry-engine/useModuleDefinition";
import { buildProductInput, type Product } from "../../features/products/products";
import { useProductsData } from "../../features/products/useProductsData";
import "./ProductPickerPanel.css";

/** Prefixo dos ids de drag desta lista — evita colisão com outros `DndContext` da tela. */
export const PRODUCT_PICKER_DRAG_PREFIX = "product-picker-";

type ProductPickerPanelProps = {
  branchId: string | null;
  /** Clique num produto adiciona direto — arrastar (ver `PRODUCT_PICKER_DRAG_PREFIX`) é a alternativa. */
  onAddProduct: (product: Product) => void;
};

type DraggableProductRowProps = {
  product: Product;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: () => void;
};

function DraggableProductRow({ product, canEdit, onAdd, onEdit }: DraggableProductRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PRODUCT_PICKER_DRAG_PREFIX}${product.id}`,
    data: { product },
  });

  return (
    <div
      ref={setNodeRef}
      className={`product-picker__row${isDragging ? " product-picker__row--dragging" : ""}`}
      {...listeners}
      {...attributes}
      onClick={onAdd}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onAdd();
        }
      }}
    >
      <span className="product-picker__row-code">{product.code}</span>
      <span className="product-picker__row-name">{product.description}</span>
      {canEdit && (
        <button
          className="product-picker__row-edit"
          type="button"
          aria-label={`Editar ${product.description}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  );
}

/**
 * Painel reutilizável "lista de produtos para adicionar a uma operação"
 * (venda, compra, devolução...). Cada linha pode ser clicada (adiciona na
 * hora) ou arrastada — quem usa este componente decide o que fazer com o
 * drop, envolvendo a tela num `DndContext` e lendo `event.active.data.current.product`.
 * O lápis (só aparece com permissão de editar Produtos) abre o mesmo modal
 * de edição do módulo Produtos, sem duplicar formulário.
 */
export default function ProductPickerPanel({ branchId, onAddProduct }: ProductPickerPanelProps) {
  const { hasPermission } = useAuth();
  const canEditProducts = hasPermission("produtos", "edit");
  const { products, updateProduct } = useProductsData(branchId);
  const { definition } = useModuleDefinition("produtos");
  const [search, setSearch] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const active = products.filter((product) => product.active);
    if (!term) return active;
    return active.filter(
      (product) =>
        product.description.toLowerCase().includes(term) || product.code.toLowerCase().includes(term),
    );
  }, [products, search]);

  const formFields = useMemo(() => (definition ? buildFormFields(definition.fields) : []), [definition]);

  async function handleEditSubmit(values: Record<string, string>) {
    if (!editingProduct) return;
    await updateProduct(editingProduct.id, buildProductInput(values));
    setEditingProduct(null);
  }

  return (
    <div className="product-picker">
      <p className="product-picker__title">Produtos</p>

      <div className="product-picker__search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Nome, código, GTIN, etc"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="product-picker__list">
        {visibleProducts.length === 0 ? (
          <p className="product-picker__empty">Nenhum produto encontrado.</p>
        ) : (
          visibleProducts.map((product) => (
            <DraggableProductRow
              key={product.id}
              product={product}
              canEdit={canEditProducts}
              onAdd={() => onAddProduct(product)}
              onEdit={() => setEditingProduct(product)}
            />
          ))
        )}
      </div>

      {editingProduct && (
        <RegistryFormModal
          title="Editar produto"
          fields={formFields}
          initialValues={{
            description: editingProduct.description,
            stock: String(editingProduct.stock),
            salePrice: String(editingProduct.salePrice),
            taxation: editingProduct.taxation ?? "",
            type: editingProduct.type ?? "",
            costPrice: editingProduct.costPrice !== undefined ? String(editingProduct.costPrice) : "",
            wholesalePrice:
              editingProduct.wholesalePrice !== undefined ? String(editingProduct.wholesalePrice) : "",
            ncm: editingProduct.ncm ?? "",
            location: editingProduct.location ?? "",
            subLocation: editingProduct.subLocation ?? "",
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditingProduct(null)}
        />
      )}
    </div>
  );
}
