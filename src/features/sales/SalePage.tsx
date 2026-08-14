import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { PRODUCT_PICKER_DRAG_PREFIX } from "../../components/product-picker/ProductPickerPanel";
import { useAuth } from "../auth/AuthContext";
import type { Product } from "../products/products";
import { SaleHandIcon } from "../home/icons";
import { formatMoney } from "./sales";
import { useSaleDraft } from "./useSaleDraft";
import SaleWizard, { type SaleIntent } from "./SaleWizard";
import { CART_DROPZONE_ID } from "./wizard/ProdutosStep";
import "./SalePage.css";

// Fora do componente: um objeto literal novo a cada render faria o `useSensor`
// devolver uma sensor list nova a cada render (ele depende da identidade do
// objeto `options`), e o `DndContext` reinicia os sensores sempre que essa
// lista muda — inclusive no meio de um drag, quando `handleDragStart` já
// causa um re-render por si só (`setDraggingProduct`). Isso cancelava o
// drag assim que ele começava.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

/** Módulo "Realizar uma venda": wizard de etapas (Cliente → Produtos → Detalhes → Faturamento → Revisão → Confirmação). */
export default function SalePage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, profile } = useAuth();
  // O vendedor nasce preenchido com quem está logado — não obriga escolher
  // manualmente toda venda, mas continua trocável pela lupa (ver ClienteStep).
  const defaultSeller = useMemo(
    () => (profile ? { id: profile.id, name: profile.name, operatorCode: profile.operatorCode } : null),
    [profile],
  );
  const draft = useSaleDraft(currentBranchId, defaultSeller);
  const [draggingProduct, setDraggingProduct] = useState<Product | null>(null);
  const [lastIntent, setLastIntent] = useState<SaleIntent | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const canCreate = hasPermission("realizar-venda", "create");

  function handleDragStart(event: DragStartEvent) {
    const product = event.active.data.current?.product as Product | undefined;
    setDraggingProduct(product ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingProduct(null);
    const isProductDrag = String(event.active.id).startsWith(PRODUCT_PICKER_DRAG_PREFIX);
    const product = event.active.data.current?.product as Product | undefined;
    if (isProductDrag && product && event.over?.id === CART_DROPZONE_ID) {
      draft.addProduct(product);
    }
  }

  useEffect(() => {
    openWindow({
      id: "realizar-venda",
      label: "Realizar uma venda",
      path: "/realizar-venda",
      icon: SaleHandIcon,
    });
  }, [openWindow]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (draft.confirmedSale) {
    const isNota = lastIntent === "nota";
    return (
      <AppShell navItems={navItems} secondaryText="Realizar venda">
        <div className="sale">
          <div className="sale__panel">
            <div className="sale__card sale__card--success">
              <p className="sale__success-title">
                {isNota
                  ? `Nota fiscal da venda ${draft.confirmedSale.code} gerada!`
                  : `Venda ${draft.confirmedSale.code} confirmada!`}
              </p>
              <p className="sale__success-total">Total: {formatMoney(draft.confirmedSale.totalAmount)}</p>
              <div className="sale__success-actions">
                <button
                  className="sale__continue"
                  type="button"
                  onClick={() => {
                    draft.reset();
                    setLastIntent(null);
                  }}
                >
                  Nova venda
                </button>
                {isNota ? (
                  <button className="sale__back" type="button" onClick={() => navigate("/notas-emitidas")}>
                    Ver nota
                  </button>
                ) : (
                  <button className="sale__back" type="button" onClick={() => navigate("/inicio")}>
                    Início
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Realizar venda">
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SaleWizard
          draft={draft}
          branchId={currentBranchId}
          canCreate={canCreate}
          onConfirmed={setLastIntent}
        />

        <DragOverlay>
          {draggingProduct ? (
            <div className="product-picker__drag-overlay">{draggingProduct.description}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </AppShell>
  );
}
