import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { ProductsIcon } from "../home/icons";
import { PRODUCTS, formatPrice, type Product } from "./products";

const COLUNAS: RegistryColumn<Product>[] = [
  { key: "code", label: "Código", width: "88px", align: "center", render: (p) => p.code },
  { key: "description", label: "Descrição", width: "minmax(0, 1fr)", render: (p) => p.description },
  { key: "stock", label: "Saldo atual", width: "110px", align: "center", render: (p) => p.stock },
  {
    key: "price",
    label: "Valor venda",
    width: "118px",
    align: "center",
    render: (p) => formatPrice(p.salePrice),
  },
];

/** Módulo "Produtos". */
export default function ProductsPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState(PRODUCTS);
  const [selectedId, setSelectedId] = useState<string | null>(PRODUCTS[0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "produtos",
      label: "Produtos",
      path: "/produtos",
      icon: ProductsIcon,
    });
  }, [openWindow]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter(
      (product) =>
        product.description.toLowerCase().includes(term) || product.code.toLowerCase().includes(term),
    );
  }, [products, search]);

  const selected: Product | null = visibleProducts.find((p) => p.id === selectedId) ?? null;

  function toggleActive() {
    if (!selected) return;
    setProducts((current) =>
      current.map((product) =>
        product.id === selected.id ? { ...product, active: !product.active } : product,
      ),
    );
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Produtos" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title="Cadastrar um novo produto"
          actions={[
            { id: "novo", label: "Novo produto" },
            { id: "editar", label: "Editar", disabled: !selected },
            { id: "clonar", label: "Clonar", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected, detached: true },
          ]}
        />

        <RegistryTable
          columns={COLUNAS}
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
            disabled: !selected,
            onToggle: toggleActive,
          }}
          fields={[
            { label: "Tributação", value: selected?.taxation },
            { label: "Tipo", value: selected?.type },
            { label: "Preço custo", value: selected?.costPrice },
            { label: "Preço Atacado", value: selected?.wholesalePrice },
            { label: "NCM", value: selected?.ncm },
            { label: "Local", value: selected?.location },
            { label: "Sub-local", value: selected?.subLocation },
            { label: "Data de cadastro", value: selected?.createdAt },
            { label: "Operador", value: selected?.operator },
          ]}
          media={{ label: "Imagem", layout: "inline" }}
        />
      </RegistryLayout>
    </AppShell>
  );
}
