import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IconsArrangement } from "../useIconsArrangement";
import { useModuleOrder } from "../useModuleOrder";
import ModuleTile from "./ModuleTile";
import SortableModuleTile from "./SortableModuleTile";

type ModuleGridProps = {
  /** "grid" (padrão) é a grade larga atual; "sidebar" encolhe para uma coluna lateral. */
  arrangement?: IconsArrangement;
};

/**
 * Grade de módulos com reordenação por arrastar — a ordem escolhida pelo
 * usuário fica salva no navegador (ver useModuleOrder). Layouts futuros
 * ("Foco", "Desktop") podem usar este mesmo componente ou só o hook,
 * conforme o arranjo que quiserem dar aos módulos.
 */
export default function ModuleGrid({ arrangement = "grid" }: ModuleGridProps) {
  const navigate = useNavigate();
  const { modules, reorder } = useModuleOrder();
  const [activeId, setActiveId] = useState<string | null>(null);

  function handleSelect(id: string) {
    const path = modules.find((module) => module.id === id)?.path;
    if (path) navigate(path);
  }

  const sensors = useSensors(
    // Mouse continua respondendo rápido (6px) — quem usa mouse não tromba
    // com a rolagem do jeito que um dedo tromba.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch: precisa segurar 3s parado no ícone para começar a arrastar.
    // Antes disso (ou se o dedo escorregar mais que a tolerância), o toque
    // é liberado para o navegador tratar como rolagem normal da página —
    // é o comportamento nativo do TouchSensor com "delay", não precisa de
    // nada extra aqui.
    useSensor(TouchSensor, { activationConstraint: { delay: 3000, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  }

  const activeModule = activeId ? modules.find((m) => m.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={modules.map((m) => m.id)} strategy={rectSortingStrategy}>
        <div className={`module-grid${arrangement === "sidebar" ? " module-grid--sidebar" : ""}`}>
          {modules.map((module) => (
            <SortableModuleTile key={module.id} module={module} onSelect={handleSelect} />
          ))}
        </div>
      </SortableContext>

      <DragOverlay>{activeModule ? <ModuleTile module={activeModule} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
