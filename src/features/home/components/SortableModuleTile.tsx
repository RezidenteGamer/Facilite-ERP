import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { HomeModule } from "../modules";
import ModuleTile from "./ModuleTile";

type SortableModuleTileProps = {
  module: HomeModule;
  onSelect?: (id: string) => void;
};

/** Envolve ModuleTile com a mecânica de arrastar do dnd-kit, sem alterar seu visual parado. */
export default function SortableModuleTile({ module, onSelect }: SortableModuleTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: module.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <ModuleTile
        module={module}
        onSelect={onSelect}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}
