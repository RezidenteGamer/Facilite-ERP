import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import FieldTypePicker from "./FieldTypePicker";
import { type NewModuleField } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

/* Identidade estável das opções de sensor — a pegadinha já documentada em
   Realizar Venda: um objeto literal criado no corpo do componente é recriado
   a cada render, e um render no meio do arraste reinicia os sensores. */
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 220, tolerance: 8 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

type FieldCanvasProps = {
  fields: ModuleFieldDefinition[];
  /** Rótulo do módulo, usado só no cabeçalho da prévia. */
  moduleLabel: string;
  /** `modules.id` → rótulo, para nomear o módulo do outro lado de uma referência. */
  moduleLabels: Record<string, string>;
  /** `full`: pode adicionar, remover e reordenar. `existing-only`: só ajustar o que já existe. */
  canAdd: boolean;
  canEdit: boolean;
  /** Vazio esconde o controle de referência inteiro (Camada 2 de M4). */
  referenceChoices: { id: string; label: string }[];
  onAdd: () => void;
  onRemove: (field: ModuleFieldDefinition) => void;
  onPatch: (field: ModuleFieldDefinition, patch: Partial<NewModuleField>) => void;
  onReorder: (orderedIds: string[]) => void;
};

/** As quatro flags por campo — as mesmas de sempre, agora dentro do cartão. */
type FlagKey = "isRequired" | "showInTable" | "showInDetails" | "showInForm";

const FLAGS: { key: FlagKey; short: string; title: string }[] = [
  { key: "isRequired", short: "Obrig.", title: "Obrigatório" },
  { key: "showInTable", short: "Tabela", title: "Aparece na tabela" },
  { key: "showInDetails", short: "Ficha", title: "Aparece na ficha" },
  { key: "showInForm", short: "Formulário", title: "Aparece no formulário" },
];

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

type FieldCardProps = Omit<FieldCanvasProps, "fields" | "moduleLabel" | "moduleLabels" | "onAdd" | "onReorder"> & {
  field: ModuleFieldDefinition;
  referenceLabel: string | null;
  onInvalid: (message: string) => void;
};

/**
 * Um campo como cartão: rótulo editável no lugar, tipo por ícone, as quatro
 * flags como chips que ligam e desligam, e a alça de arraste.
 *
 * **Só a alça carrega os listeners do dnd-kit.** É o que deixa o cartão ser um
 * cartão e um formulário ao mesmo tempo: sem isso, o sensor engoliria o
 * clique de cada chip e de cada ícone de tipo — a mesma pegadinha que o
 * `ProductPickerPanel` resolveu com `activationConstraint`, só que aqui o
 * conflito é dentro do próprio item arrastável.
 */
function FieldCard({
  field,
  canAdd,
  canEdit,
  referenceChoices,
  referenceLabel,
  onRemove,
  onPatch,
  onInvalid,
}: FieldCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: !canEdit,
  });
  const [label, setLabel] = useState(field.label);

  function commitLabel() {
    const next = label.trim();
    if (!next) {
      setLabel(field.label);
      onInvalid("O campo precisa de um rótulo.");
      return;
    }
    if (next !== field.label) onPatch(field, { label: next });
  }

  function toggleFlag(key: FlagKey) {
    const current = field[key];
    /* A mesma regra do formulário antigo, agora checada no clique: um campo
       que não aparece em lugar nenhum é um campo invisível com dado gravado. */
    if (current && key !== "isRequired") {
      const remaining = FLAGS.filter(
        (flag) => flag.key !== "isRequired" && flag.key !== key,
      ).some((flag) => field[flag.key]);
      if (!remaining) {
        onInvalid("O campo precisa aparecer em pelo menos um lugar (tabela, ficha ou formulário).");
        return;
      }
    }
    onPatch(field, { [key]: !current } as Partial<NewModuleField>);
  }

  return (
    <article
      ref={setNodeRef}
      className={`module-builder__card${isDragging ? " module-builder__card--dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <header className="module-builder__card-head">
        {canEdit ? (
          <button
            className="module-builder__grip"
            type="button"
            aria-label={`Arrastar ${field.label}`}
            title="Arrastar para reordenar"
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
        ) : (
          <span className="module-builder__grip module-builder__grip--off" aria-hidden="true">
            <GripIcon />
          </span>
        )}

        <div className="module-builder__card-title">
          {canEdit ? (
            <input
              className="module-builder__card-label"
              value={label}
              aria-label="Rótulo do campo"
              onChange={(event) => setLabel(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setLabel(field.label);
              }}
            />
          ) : (
            <span className="module-builder__card-label module-builder__card-label--static">
              {field.label}
            </span>
          )}
          <code className="module-builder__card-key">{field.fieldKey}</code>
        </div>

        {canAdd && (
          <button
            className="module-builder__card-remove"
            type="button"
            title="Remover campo"
            aria-label={`Remover ${field.label}`}
            onClick={() => onRemove(field)}
          >
            ×
          </button>
        )}
      </header>

      <FieldTypePicker
        size="small"
        value={field.dataType}
        disabled={!canEdit}
        onChange={(next) => onPatch(field, { dataType: next })}
      />

      <div className="module-builder__chips">
        {FLAGS.map((flag) => {
          const on = field[flag.key];
          return (
            <button
              key={flag.key}
              type="button"
              disabled={!canEdit}
              title={flag.title}
              aria-pressed={on}
              className={`module-builder__chip${on ? " module-builder__chip--on" : ""}`}
              onClick={() => toggleFlag(flag.key)}
            >
              {flag.short}
            </button>
          );
        })}
      </div>

      {/* Camada 2 de M4: some inteiro para quem não é desenvolvedor do
          Facilite — a lista chega vazia, e não existe cadeado anunciando uma
          capacidade que a pessoa nunca vai poder usar. Quando o campo já
          aponta para outro módulo, o apontamento continua legível para todo
          mundo (é informação, não controle). */}
      {referenceChoices.length > 0 ? (
        <label className="module-builder__card-ref">
          <span>Referência</span>
          <select
            className="module-builder__card-select"
            value={field.referenceModuleId ?? ""}
            onChange={(event) =>
              onPatch(field, { referenceModuleId: event.target.value || null })
            }
          >
            <option value="">Nenhuma</option>
            {referenceChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        referenceLabel && (
          <p className="module-builder__card-refnote">Aponta para {referenceLabel}</p>
        )
      )}
    </article>
  );
}

/**
 * Prévia ao vivo da lista do módulo: os rótulos dos campos marcados como
 * "aparece na tabela", na ordem atual do canvas.
 *
 * É o que faz o canvas ser canvas e não só cartões no lugar de linhas —
 * arrastar um cartão muda o cabeçalho aqui na hora, então a ordem deixa de
 * ser um número numa coluna e passa a ser a coisa que se está montando.
 */
function ListPreview({
  fields,
  moduleLabel,
}: {
  fields: ModuleFieldDefinition[];
  moduleLabel: string;
}) {
  const visible = fields.filter((field) => field.showInTable);

  return (
    <div className="module-builder__preview">
      <p className="module-builder__preview-cap">Prévia da lista de {moduleLabel}</p>
      {visible.length === 0 ? (
        <p className="module-builder__empty">
          Nenhum campo marcado como “Tabela” — a lista do módulo sairia sem colunas.
        </p>
      ) : (
        <div className="module-builder__preview-wrap">
          <table className="module-builder__preview-table">
            <thead>
              <tr>
                {visible.map((field) => (
                  <th key={field.id}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1].map((row) => (
                <tr key={row}>
                  {visible.map((field) => (
                    <td key={field.id}>—</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Canvas de campos do construtor de módulos — no lugar da tabela técnica
 * (Rótulo/Chave/Tipo/Obrig./Tabela/Ficha/Formulário) que existia até aqui.
 *
 * O mecanismo de arrastar é espelhado de `ModuleGrid` (`@dnd-kit/sortable` +
 * `rectSortingStrategy`), que é o mesmo problema: blocos numa grade que se
 * reorganizam ao arrastar. Duas diferenças deliberadas:
 *
 * - **sem `DragOverlay`**: o próprio cartão segue o cursor pelo `transform`
 *   que o `useSortable` devolve. `.module-builder__detail` tem
 *   `backdrop-filter`, que cria um *containing block* para `position: fixed` —
 *   um `DragOverlay` aqui precisaria do `createPortal` explícito documentado
 *   em Ajuste de estoque. Não usar overlay resolve o mesmo problema sem a
 *   peça extra.
 * - **a ordem nova é gravada no banco**, não só no navegador: `sort_order` de
 *   `module_fields` é o que a tabela, a ficha e o formulário do módulo leem.
 */
export default function FieldCanvas({
  fields,
  moduleLabel,
  moduleLabels,
  canAdd,
  canEdit,
  referenceChoices,
  onAdd,
  onRemove,
  onPatch,
  onReorder,
}: FieldCanvasProps) {
  const [hint, setHint] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(fields, from, to).map((field) => field.id));
  }

  return (
    <section className="module-builder__canvas-block">
      <div className="module-builder__canvas-head">
        <div>
          <h3 className="module-builder__workflow-title">Campos</h3>
          <p className="module-builder__workflow-sub">
            {canEdit
              ? "Arraste os cartões para mudar a ordem — é a mesma ordem da tabela, da ficha e do formulário do módulo."
              : "Este módulo não aceita edição de campos."}
          </p>
        </div>
        {canAdd && (
          <button
            className="module-builder__btn module-builder__btn--small"
            type="button"
            onClick={onAdd}
          >
            Novo campo
          </button>
        )}
      </div>

      {hint && <p className="module-builder__error">{hint}</p>}

      {fields.length === 0 ? (
        <p className="module-builder__empty">Este módulo não tem campos cadastrados.</p>
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={fields.map((field) => field.id)} strategy={rectSortingStrategy}>
              <div className="module-builder__canvas">
                {fields.map((field) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    canAdd={canAdd}
                    canEdit={canEdit}
                    referenceChoices={referenceChoices}
                    referenceLabel={
                      field.referenceModuleId
                        ? (moduleLabels[field.referenceModuleId] ?? field.referenceModuleId)
                        : null
                    }
                    onRemove={onRemove}
                    onPatch={(target, patch) => {
                      setHint(null);
                      onPatch(target, patch);
                    }}
                    onInvalid={setHint}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <ListPreview fields={fields} moduleLabel={moduleLabel} />
        </>
      )}
    </section>
  );
}
