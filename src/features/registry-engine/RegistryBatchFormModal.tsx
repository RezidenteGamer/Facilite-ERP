import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FormField from "../../components/form/FormField";
import { buildFormFields } from "./moduleView";
import type { ModuleFieldDefinition } from "./types";
import "./RegistryBatchFormModal.css";

// Fora do componente para ter identidade estável entre renders: o
// `onDragStart` já dispara um `setState` (para o `DragOverlay`) no meio do
// arraste, e um objeto de opções recriado reinicia os sensores e cancela o
// drag em andamento. Sem `activationConstraint`, o dnd-kit ainda engoliria o
// clique simples do seletor como início de arraste.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

const DROPZONE_ID = "registry-batch-dropzone";

/**
 * Um item já escolhido para o lote. O motor não sabe (nem quer saber) o que o
 * item é — produto, insumo, nota. Só precisa de identidade, de um rótulo para
 * mostrar na linha e, opcionalmente, de um texto auxiliar.
 */
export type BatchItem = {
  /** Identidade do item no domínio de quem chama — também evita duplicata no lote. */
  id: string;
  label: string;
  /** Texto auxiliar da linha (ex.: "Estoque atual: 142"). */
  hint?: string;
};

/** Uma linha pendente: o item escolhido + os valores digitados nos campos do módulo. */
export type BatchRow = {
  item: BatchItem;
  values: Record<string, string>;
};

type RegistryBatchFormModalProps = {
  title: string;
  /** Campos do módulo — o recorte `showInForm` é feito aqui por `buildFormFields`. */
  fields: ModuleFieldDefinition[];
  /**
   * Como escolher um item. O motor **não** implementa isso de propósito: se
   * ele soubesse procurar produto, deixaria de ser genérico e não serviria
   * para Compras/Devolução depois. Quem consome passa o seletor do seu
   * domínio (ex.: `ProductPickerPanel`) e chama `onPick` quando o usuário
   * escolher.
   */
  renderItemPicker: (onPick: (item: BatchItem) => void) => ReactNode;
  /**
   * Traduz o payload de um item **arrastado** para dentro da lista
   * (`event.active.data.current` do dnd-kit) em um `BatchItem`; devolver
   * `null` ignora o drop. Sem esta prop a lista só aceita clique — o motor
   * fornece o `DndContext` e a área de soltar, mas continua sem saber o que
   * está sendo arrastado.
   */
  resolveDraggedItem?: (dragData: Record<string, unknown> | undefined) => BatchItem | null;
  /** Texto mostrado enquanto o lote está vazio. */
  emptyHint?: string;
  submitLabel?: string;
  /**
   * Validação específica do módulo para uma linha, além do `isRequired` que o
   * motor já cobre. Retorna a mensagem de erro ou `null`.
   */
  validateRow?: (values: Record<string, string>) => string | null;
  onSubmit: (rows: BatchRow[]) => Promise<void>;
  onCancel: () => void;
};

/**
 * Erros do supabase-js (`PostgrestError`, inclusive os levantados de dentro de
 * uma RPC) são objetos simples, não instâncias de `Error` — checar só
 * `err instanceof Error` engole a mensagem real.
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return fallback;
}

/**
 * Área de soltar da lista. Precisa ser um componente **filho** do
 * `<DndContext>`: `useDroppable` só enxerga o contexto mais próximo acima dele
 * na árvore, então chamá-lo no mesmo componente que declara o `DndContext`
 * não funciona (pegadinha já documentada em Realizar Venda).
 */
function BatchDropzone({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROPZONE_ID });

  return (
    <div
      ref={setNodeRef}
      className={`registry-batch-modal__rows${isOver ? " registry-batch-modal__rows--over" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * Formulário de lançamento **em lote** (`layoutVariant: "batch"`): em vez de
 * um registro por vez como o `RegistryFormModal`, acumula N linhas e confirma
 * todas juntas numa escrita só.
 *
 * O que é genérico aqui é a UI e os metadados de campo. A escrita atômica
 * continua sendo de cada módulo (uma RPC Postgres dedicada) — `onSubmit` só
 * entrega as linhas prontas para quem chamou gravar.
 */
export default function RegistryBatchFormModal({
  title,
  fields,
  renderItemPicker,
  resolveDraggedItem,
  emptyHint = "Escolha os itens ao lado para montar o lote.",
  submitLabel = "Confirmar lote",
  validateRow,
  onSubmit,
  onCancel,
}: RegistryBatchFormModalProps) {
  const formFields = useMemo(() => buildFormFields(fields), [fields]);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingItem, setDraggingItem] = useState<BatchItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  function handleDragStart(event: DragStartEvent) {
    setDraggingItem(resolveDraggedItem?.(event.active.data.current) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const item = draggingItem;
    setDraggingItem(null);
    if (event.over?.id !== DROPZONE_ID || !item) return;
    addItem(item);
  }

  function addItem(item: BatchItem) {
    // O mesmo item duas vezes no lote quase sempre é clique repetido, não
    // intenção — a linha que já existe continua valendo.
    if (rows.some((row) => row.item.id === item.id)) {
      setError(`"${item.label}" já está no lote.`);
      return;
    }
    const values: Record<string, string> = {};
    for (const field of formFields) values[field.accessorKey] = "";
    setError(null);
    setRows((current) => [...current, { item, values }]);
  }

  function removeRow(itemId: string) {
    setError(null);
    setRows((current) => current.filter((row) => row.item.id !== itemId));
  }

  function setRowValue(itemId: string, accessorKey: string, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.item.id === itemId ? { ...row, values: { ...row.values, [accessorKey]: value } } : row,
      ),
    );
  }

  async function handleSubmit() {
    if (rows.length === 0) return;

    for (const row of rows) {
      const missing = formFields.filter(
        (field) => field.isRequired && !row.values[field.accessorKey]?.trim(),
      );
      if (missing.length > 0) {
        setError(`"${row.item.label}": preencha ${missing.map((field) => field.label).join(", ")}.`);
        return;
      }
      const rowError = validateRow?.(row.values);
      if (rowError) {
        setError(`"${row.item.label}": ${rowError}`);
        return;
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(rows);
    } catch (err) {
      setError(extractErrorMessage(err, "Não foi possível gravar o lote."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-batch-modal__overlay">
          <Dialog.Content className="registry-batch-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-batch-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {error && (
              <p className="registry-batch-modal__error" role="alert">
                {error}
              </p>
            )}

            {/* O `DndContext` envolve seletor **e** lista: o item sai de um e
                é solto no outro, então os dois precisam do mesmo contexto.
                `pointerWithin` em vez da colisão padrão por retângulos: com um
                único alvo de soltar, a colisão por retângulo dava `isOver` mesmo
                com o cursor longe da lista, e o item entrava ao soltar em
                qualquer lugar. Aqui o alvo só conta se o ponteiro estiver
                dentro dele — que é o que a pessoa enxerga. */}
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="registry-batch-modal__body">
                <div className="registry-batch-modal__picker">{renderItemPicker(addItem)}</div>

                <BatchDropzone>
                  {rows.length === 0 ? (
                    <p className="registry-batch-modal__empty">{emptyHint}</p>
                  ) : (
                    rows.map((row) => (
                      <div className="registry-batch-modal__row" key={row.item.id}>
                        <div className="registry-batch-modal__row-head">
                          <div>
                            <p className="registry-batch-modal__row-label">{row.item.label}</p>
                            {row.item.hint && (
                              <p className="registry-batch-modal__row-hint">{row.item.hint}</p>
                            )}
                          </div>
                          <button
                            className="registry-batch-modal__row-remove"
                            type="button"
                            aria-label={`Remover ${row.item.label} do lote`}
                            onClick={() => removeRow(row.item.id)}
                            disabled={submitting}
                          >
                            ×
                          </button>
                        </div>

                        <div className="registry-batch-modal__row-fields">
                          {formFields.map((field) => (
                            <FormField
                              key={field.accessorKey}
                              id={`registry-batch-${row.item.id}-${field.accessorKey}`}
                              label={field.isRequired ? `${field.label} *` : field.label}
                              type={field.dataType === "date" ? "date" : "text"}
                              value={row.values[field.accessorKey] ?? ""}
                              disabled={submitting}
                              onChange={(value) => setRowValue(row.item.id, field.accessorKey, value)}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </BatchDropzone>
              </div>

              {/*
                Portal explícito para `document.body`, fora da árvore do
                modal. Nesta versão do dnd-kit, `<DragOverlay>` NÃO se porta
                sozinho — ele renderiza `position: fixed` no lugar onde foi
                declarado no DOM. `.registry-batch-modal` tem `backdrop-filter`,
                que cria um *containing block* novo para `position: fixed`
                (mesma categoria de `transform`/`filter`) — sem este portal, o
                fantasma do arraste fica posicionado relativo ao modal, não à
                viewport, e aparece deslocado do cursor — o desvio cresce
                quanto mais longe o modal estiver do canto superior esquerdo
                da tela. Realizar Venda nunca teve esse bug porque seu
                `DragOverlay` não vive dentro de nenhum ancestral com
                `backdrop-filter`.
              */}
              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {draggingItem && (
                    <div className="registry-batch-modal__drag-ghost">{draggingItem.label}</div>
                  )}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>

            <div className="registry-batch-modal__actions">
              <span className="registry-batch-modal__count">
                {rows.length === 0
                  ? "Nenhum item no lote"
                  : `${rows.length} ${rows.length === 1 ? "item no lote" : "itens no lote"}`}
              </span>
              <button
                className="registry-batch-modal__btn registry-batch-modal__btn--cancel"
                type="button"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                className="registry-batch-modal__btn registry-batch-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
                disabled={rows.length === 0 || submitting}
              >
                {submitting ? "Gravando..." : submitLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
