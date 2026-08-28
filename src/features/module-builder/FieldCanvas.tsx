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
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import { RegistryTable } from "../../components/registry";
import type { GenericRow } from "../../lib/repositories/genericModuleRepository";
import { useGenericModuleData } from "../modules/useGenericModuleData";
import { useModuleReferences } from "../modules/useModuleReferences";
import { buildTableColumns } from "../registry-engine/moduleView";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import FieldTypeIcon from "./FieldTypeIcon";
import FieldTypePicker from "./FieldTypePicker";
import { FIELD_TYPES, type BuilderModule, type NewModuleField } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

/* Identidade estável das opções de sensor — a pegadinha já documentada em
   Realizar Venda: um objeto literal criado no corpo do componente é recriado
   a cada render, e um render no meio do arraste reinicia os sensores. */
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 220, tolerance: 8 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

/* Mesma guarda dos atalhos numéricos do `WindowDock`: um atalho global que
   dispara com o foco dentro de um campo de digitação rouba a tecla de quem
   está escrevendo — aqui seria o rótulo do campo no Inspetor engolindo Delete,
   e o Ctrl+Z do navegador (desfazer o texto digitado) virando um desfazer de
   campo. */
function isEditableTarget(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

type FieldCanvasProps = {
  fields: ModuleFieldDefinition[];
  /**
   * O módulo selecionado inteiro, não só o rótulo: a prévia central busca os
   * registros reais dele, e para isso precisa saber onde o dado mora
   * (`storageKind`/`dataTable`) e se é isolado por filial.
   */
  module: BuilderModule;
  /** `modules.id` → rótulo, para nomear o módulo do outro lado de uma referência. */
  moduleLabels: Record<string, string>;
  /** `full`: pode adicionar, remover e reordenar. `existing-only`: só ajustar o que já existe. */
  canAdd: boolean;
  canEdit: boolean;
  /** Vazio esconde o controle de referência inteiro (Camada 2 de M4). */
  referenceChoices: { id: string; label: string }[];
  /** Filial ativa — a prévia respeita o mesmo isolamento da tela publicada. */
  branchId: string | null;
  /** `has_permission(module, 'view')`: sem isso a prévia não busca nada. */
  canViewRecords: boolean;
  /** `false` enquanto houver um modal aberto — o diálogo de confirmação também
      responde ao teclado, e dois donos da mesma tecla é um bug. */
  shortcutsEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAdd: () => void;
  onRemove: (field: ModuleFieldDefinition) => void;
  /** Remoção em lote: a página abre o mesmo diálogo de atrito, no plural. */
  onRemoveMany: (fields: ModuleFieldDefinition[]) => void;
  /**
   * Uma lista de campos desejada, reconciliada contra a atual pela mesma peça
   * da Fase 2 (`fieldsJsonPlan`). É por aqui que as ações em lote gravam:
   * quatro campos ganhando a mesma flag viram **um** plano e uma releitura, em
   * vez de quatro `editField` encadeados — e ficam desfazíveis de graça, pelo
   * mesmo caminho.
   */
  onApplyFields: (fields: ModuleFieldDefinition[]) => void;
  onPatch: (field: ModuleFieldDefinition, patch: Partial<NewModuleField>) => void;
  onReorder: (orderedIds: string[]) => void;
};

/** As quatro flags por campo — as mesmas de sempre, agora como interruptores. */
type FlagKey = "isRequired" | "showInTable" | "showInDetails" | "showInForm";

const FLAGS: { key: FlagKey; label: string; hint: string }[] = [
  { key: "isRequired", label: "Obrigatório", hint: "O formulário recusa salvar sem valor." },
  { key: "showInTable", label: "Mostrar na tabela", hint: "Vira coluna da lista do módulo." },
  { key: "showInDetails", label: "Mostrar na ficha", hint: "Aparece no painel do registro selecionado." },
  { key: "showInForm", label: "Mostrar no formulário", hint: "Aparece ao criar e ao editar." },
];

function typeLabel(dataType: ModuleFieldDefinition["dataType"]): string {
  return FIELD_TYPES.find((type) => type.value === dataType)?.label ?? dataType;
}

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

/**
 * Um campo na lista da esquerda: alça de arraste, rótulo e o tipo em texto
 * pequeno. **Nenhum controle de edição mora aqui** — quem edita é o Inspetor,
 * e a linha só decide qual campo ele está editando.
 *
 * **Só a alça carrega os listeners do dnd-kit**, como no cartão que existia
 * antes: sem isso o sensor engoliria o clique de seleção da própria linha.
 * O clique-depois-do-arraste (a guarda de 200 ms que o diagrama de workflow
 * precisou) não é problema aqui porque arrastar e selecionar são dois alvos
 * diferentes dentro da linha.
 *
 * O clique de seleção entrega o evento inteiro para cima: Shift e Ctrl/Cmd
 * mudam o que ele significa, e quem sabe traduzir isso é quem tem a lista
 * (intervalo precisa das duas pontas).
 */
function FieldRow({
  field,
  selected,
  canEdit,
  onSelect,
}: {
  field: ModuleFieldDefinition;
  selected: boolean;
  canEdit: boolean;
  onSelect: (id: string, event: ReactMouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: !canEdit,
  });

  return (
    <li
      ref={setNodeRef}
      className={`module-builder__field-row${selected ? " module-builder__field-row--selected" : ""}${
        isDragging ? " module-builder__field-row--dragging" : ""
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
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

      <button
        className="module-builder__field-pick"
        type="button"
        data-field-id={field.id}
        aria-pressed={selected}
        onClick={(event) => onSelect(field.id, event)}
      >
        <span className="module-builder__field-name">{field.label}</span>
        <span className="module-builder__field-type">
          <FieldTypeIcon dataType={field.dataType} className="module-builder__field-row-glyph" />
          {typeLabel(field.dataType)}
          {!field.showInTable && <span className="module-builder__field-off">fora da tabela</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * Prévia central — **a tabela real do sistema**, não um desenho dela.
 *
 * `RegistryTable` alimentada por `buildTableColumns(fields, …)` é literalmente
 * o par que `GenericModulePage` monta em produção, e as linhas saem do mesmo
 * `useGenericModuleData` filtrando pelo módulo selecionado. É isso que faz a
 * prévia valer alguma coisa: mudar um rótulo, um tipo ou uma flag no Inspetor
 * muda a tabela publicada na tela, com a cara exata dela — sem registro
 * nenhum, cai no estado vazio que a própria `RegistryTable` já desenha.
 *
 * Clicar num cabeçalho seleciona o campo daquela coluna (prop `onColumnSelect`,
 * que só a prévia usa): é a mesma seleção da lista da esquerda, pelo caminho
 * de quem está olhando para o resultado em vez de para a lista de campos.
 */
function TablePreview({
  module,
  fields,
  branchId,
  enabled,
  selectedField,
  onSelectField,
}: {
  module: BuilderModule;
  fields: ModuleFieldDefinition[];
  branchId: string | null;
  enabled: boolean;
  selectedField: ModuleFieldDefinition | null;
  onSelectField: (id: string) => void;
}) {
  const { rows, error } = useGenericModuleData({
    moduleId: module.id,
    storageKind: module.storageKind,
    table: module.dataTable,
    fields,
    branchId,
    branchScoped: module.branchScoped,
    enabled: enabled && (module.storageKind === "generic" || Boolean(module.dataTable)),
  });

  /* Rótulo legível no lugar do uuid nas colunas de referência — a mesma peça
     que a tela publicada usa, senão a prévia mostraria uuid onde o módulo
     mostra nome. */
  const references = useModuleReferences(fields, enabled && module.storageKind === "generic");

  const columns = useMemo(
    () => buildTableColumns<GenericRow>(fields, references.labels),
    [fields, references.labels],
  );

  /* A tela publicada seleciona a primeira linha sozinha; a prévia faz igual,
     senão a comparação lado a lado teria uma diferença que não vem de
     nenhuma decisão de campo. */
  const [rowId, setRowId] = useState<string | null>(null);
  useEffect(() => {
    setRowId((current) => {
      if (current && rows.some((row) => row.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [rows]);

  return (
    <>
      {error && <p className="module-builder__pane-note">{error}</p>}

      {columns.length === 0 ? (
        <p className="module-builder__empty">
          Nenhum campo com “Mostrar na tabela” — a lista do módulo sairia sem colunas.
        </p>
      ) : (
        <RegistryTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          selectedId={rowId}
          onSelect={setRowId}
          onColumnSelect={(key) => {
            const field = fields.find((item) => item.fieldKey === key);
            if (field) onSelectField(field.id);
          }}
          selectedColumnKey={selectedField?.fieldKey ?? null}
        />
      )}
    </>
  );
}

/** Interruptor de verdade no lugar do chip clicável: o estado ligado/desligado
    fica visível sem precisar decodificar preenchimento de fundo. Mesmo desenho
    do interruptor de Configurações e da ficha (trilho + botão branco
    deslizante), num tamanho menor porque aqui são quatro empilhados; a única
    diferença é o trilho desligado ser neutro em vez de vermelho — “não aparece
    na tabela” é uma escolha comum de campo, não um alerta. */
function FlagSwitch({
  on,
  label,
  hint,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  hint: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="module-builder__flag">
      <span className="module-builder__flag-text">
        <span className="module-builder__flag-label">{label}</span>
        <span className="module-builder__flag-hint">{hint}</span>
      </span>
      <button
        className={`module-builder__switch${on ? " module-builder__switch--on" : ""}`}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="module-builder__switch-knob" />
      </button>
    </div>
  );
}

/**
 * Inspetor — o painel da direita, com tudo que antes morava dentro do cartão:
 * rótulo, tipo, referência e as quatro flags de visibilidade.
 *
 * Continua gravando na hora, a cada mexida (o mesmo `onPatch`/`editField` de
 * sempre): não existe "editar e salvar depois" nesta tela, e inventar um botão
 * "Salvar" aqui criaria um estado intermediário que a prévia ao lado não
 * saberia representar.
 */
function FieldInspector({
  field,
  canAdd,
  canEdit,
  referenceChoices,
  referenceLabel,
  onRemove,
  onPatch,
  hint,
  onHint,
}: {
  field: ModuleFieldDefinition;
  canAdd: boolean;
  canEdit: boolean;
  referenceChoices: { id: string; label: string }[];
  referenceLabel: string | null;
  onRemove: (field: ModuleFieldDefinition) => void;
  onPatch: (field: ModuleFieldDefinition, patch: Partial<NewModuleField>) => void;
  hint: string | null;
  onHint: (message: string | null) => void;
}) {
  const [label, setLabel] = useState(field.label);

  /* O Inspetor é remontado a cada troca de campo (`key` no chamador), então o
     rascunho do rótulo nunca vaza de um campo para outro; este efeito cobre o
     outro caminho — o rótulo mudou no banco e voltou pela recarga. */
  useEffect(() => {
    setLabel(field.label);
  }, [field.label]);

  function commitLabel() {
    const next = label.trim();
    if (!next) {
      setLabel(field.label);
      onHint("O campo precisa de um rótulo.");
      return;
    }
    if (next !== field.label) {
      onHint(null);
      onPatch(field, { label: next });
    }
  }

  function toggleFlag(key: FlagKey) {
    const current = field[key];
    /* A mesma regra do formulário antigo, checada no clique: um campo que não
       aparece em lugar nenhum é um campo invisível com dado gravado. */
    if (current && key !== "isRequired") {
      const remaining = FLAGS.filter(
        (flag) => flag.key !== "isRequired" && flag.key !== key,
      ).some((flag) => field[flag.key]);
      if (!remaining) {
        onHint("O campo precisa aparecer em pelo menos um lugar (tabela, ficha ou formulário).");
        return;
      }
    }
    onHint(null);
    onPatch(field, { [key]: !current } as Partial<NewModuleField>);
  }

  return (
    <div className="module-builder__inspector">
      <div className="module-builder__inspector-head">
        <code className="module-builder__inspector-key">{field.fieldKey}</code>
        {canAdd && (
          <button
            className="module-builder__inspector-remove"
            type="button"
            title="Remover campo"
            aria-label={`Remover ${field.label}`}
            onClick={() => onRemove(field)}
          >
            ×
          </button>
        )}
      </div>

      <label className="module-builder__prop">
        <span className="module-builder__prop-label">Rótulo</span>
        {canEdit ? (
          <input
            className="module-builder__prop-input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setLabel(field.label);
            }}
          />
        ) : (
          <span className="module-builder__prop-static">{field.label}</span>
        )}
      </label>

      <div className="module-builder__prop">
        <span className="module-builder__prop-label">Tipo</span>
        <FieldTypePicker
          value={field.dataType}
          disabled={!canEdit}
          onChange={(next) => {
            onHint(null);
            onPatch(field, { dataType: next });
          }}
        />
      </div>

      {/* Camada 2 de M4: some inteiro para quem não é desenvolvedor do
          Facilite — a lista chega vazia, e não existe cadeado anunciando uma
          capacidade que a pessoa nunca vai poder usar. Quando o campo já
          aponta para outro módulo, o apontamento continua legível para todo
          mundo (é informação, não controle). */}
      {referenceChoices.length > 0 ? (
        <label className="module-builder__prop">
          <span className="module-builder__prop-label">Referência</span>
          <select
            className="module-builder__prop-select"
            value={field.referenceModuleId ?? ""}
            disabled={!canEdit}
            onChange={(event) => {
              onHint(null);
              onPatch(field, { referenceModuleId: event.target.value || null });
            }}
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
          <p className="module-builder__inspector-refnote">Aponta para {referenceLabel}</p>
        )
      )}

      <div className="module-builder__prop">
        <span className="module-builder__prop-label">Visibilidade</span>
        <div className="module-builder__flags">
          {FLAGS.map((flag) => (
            <FlagSwitch
              key={flag.key}
              on={field[flag.key]}
              label={flag.label}
              hint={flag.hint}
              disabled={!canEdit}
              onToggle={() => toggleFlag(flag.key)}
            />
          ))}
        </div>
      </div>

      {hint && <p className="module-builder__error">{hint}</p>}
    </div>
  );
}

/**
 * Inspetor em modo lote — o painel da direita quando há **mais de um** campo
 * selecionado.
 *
 * Só aparece aqui o que faz sentido aplicar a vários campos de uma vez: as
 * quatro flags de visibilidade e a remoção. Rótulo, tipo e referência ficam de
 * fora de propósito — "renomear três campos para o mesmo nome" não é uma
 * operação que alguém queira, e um campo de texto vazio no lugar deles seria
 * um convite a fazer justamente isso.
 *
 * O interruptor mostra ligado só quando **todos** os selecionados estão
 * ligados; o rodapé de cada linha diz a contagem, que é a informação que falta
 * quando a seleção é mista. Clicar liga todos, ou desliga todos se já estavam
 * todos ligados — uma decisão só para a seleção inteira, nunca um "inverte
 * cada um", que produziria um estado que ninguém pediu.
 */
function BatchInspector({
  selection,
  canAdd,
  canEdit,
  onSetFlag,
  onRemoveMany,
  hint,
  onHint,
}: {
  selection: ModuleFieldDefinition[];
  canAdd: boolean;
  canEdit: boolean;
  onSetFlag: (key: FlagKey, value: boolean) => void;
  onRemoveMany: (fields: ModuleFieldDefinition[]) => void;
  hint: string | null;
  onHint: (message: string | null) => void;
}) {
  function toggleFlag(key: FlagKey) {
    const allOn = selection.every((field) => field[key]);
    const next = !allOn;

    /* A mesma regra de sempre, checada no clique — e recusando a operação
       **inteira** se um só dos selecionados ficaria invisível: aplicar em
       alguns e pular outros deixaria a seleção em dois estados diferentes sem
       ninguém pedir isso. A mensagem nomeia o campo que barrou. */
    if (!next && key !== "isRequired") {
      const offender = selection.find((field) => {
        const after = { ...field, [key]: false };
        return !after.showInTable && !after.showInDetails && !after.showInForm;
      });
      if (offender) {
        onHint(
          `“${offender.label}” ficaria sem aparecer em lugar nenhum (tabela, ficha ou formulário). Nada foi alterado.`,
        );
        return;
      }
    }

    onHint(null);
    onSetFlag(key, next);
  }

  return (
    <div className="module-builder__inspector">
      <div className="module-builder__inspector-head">
        <span className="module-builder__batch-count">{selection.length} campos selecionados</span>
      </div>

      <p className="module-builder__batch-note">
        Rótulo, tipo e referência são de um campo por vez — selecione um só para editá-los.
      </p>

      <div className="module-builder__prop">
        <span className="module-builder__prop-label">Visibilidade</span>
        <div className="module-builder__flags">
          {FLAGS.map((flag) => {
            const on = selection.every((field) => field[flag.key]);
            const count = selection.filter((field) => field[flag.key]).length;
            return (
              <FlagSwitch
                key={flag.key}
                on={on}
                label={flag.label}
                hint={`${count} de ${selection.length} ligados`}
                disabled={!canEdit}
                onToggle={() => toggleFlag(flag.key)}
              />
            );
          })}
        </div>
      </div>

      {canAdd && (
        <button
          className="module-builder__btn module-builder__btn--small module-builder__btn--danger module-builder__batch-remove"
          type="button"
          onClick={() => onRemoveMany(selection)}
        >
          Remover campos selecionados
        </button>
      )}

      {hint && <p className="module-builder__error">{hint}</p>}
    </div>
  );
}

/**
 * Editor de campos do construtor de módulos, em três painéis: **lista de
 * campos | prévia com a tabela real | Inspetor de propriedades**.
 *
 * Substitui a grade de cartões (cada um aberto com todos os controles) mais a
 * prévia ilustrativa que existia até aqui. O público desta tela é o
 * desenvolvedor da Facilite (`is_facilite_developer`, decisão de 28/08/2026),
 * então a forma que serve é a de um editor de propriedades — uma lista
 * enxuta, o resultado real no meio e um só lugar para mexer nas propriedades
 * do que está selecionado —, não uma parede de formulários repetidos.
 *
 * O que **não** mudou: `sort_order` continua vindo do arraste
 * (`@dnd-kit/sortable`, agora em lista vertical no lugar da grade) e continua
 * indo para o banco; a fronteira de M3 continua chegando como `canAdd`/
 * `canEdit`; cada mexida no Inspetor continua gravando na hora; e não há
 * `DragOverlay` — `.module-builder__detail` tem `backdrop-filter`, que cria
 * *containing block* para `position: fixed`, e um overlay ali precisaria do
 * `createPortal` documentado em Ajuste de estoque.
 */
export default function FieldCanvas({
  fields,
  module,
  moduleLabels,
  canAdd,
  canEdit,
  referenceChoices,
  branchId,
  canViewRecords,
  shortcutsEnabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAdd,
  onRemove,
  onRemoveMany,
  onApplyFields,
  onPatch,
  onReorder,
}: FieldCanvasProps) {
  const [hint, setHint] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** De onde o Shift mede o intervalo, e de onde as setas andam. */
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /* Enquanto o dnd-kit está arrastando, as setas são **dele** (é assim que o
     `KeyboardSensor` move o item). Sem esta guarda os dois donos da tecla
     brigariam: o campo iria para uma posição e a seleção para outra. */
  const [dragging, setDragging] = useState(false);

  /* Seleção derivada, não espelhada — a mesma decisão da Fase 3, agora no
     plural: `fields` é a verdade, então trocar de módulo ou remover um campo
     selecionado o tira da seleção sozinho, sem efeito de sincronização e sem
     id morto sobrando no estado. */
  const selection = useMemo(
    () => fields.filter((field) => selectedIds.includes(field.id)),
    [fields, selectedIds],
  );
  /* O Inspetor de um campo só existe quando há exatamente um selecionado —
     com dois ou mais quem responde é o `BatchInspector`. */
  const selectedField = selection.length === 1 ? selection[0] : null;

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  function selectOnly(id: string) {
    setHint(null);
    setSelectedIds([id]);
    setAnchorId(id);
  }

  /**
   * Clique na lista, com os três gestos de sempre de uma lista de editor:
   * clique simples troca a seleção, `Shift` estende um intervalo a partir da
   * âncora, `Ctrl`/`Cmd` acrescenta ou tira um item.
   *
   * A âncora **não** se move no Shift: é o que permite arrastar o intervalo
   * para os dois lados sem perder a ponta de origem.
   */
  function handlePick(id: string, event: ReactMouseEvent) {
    setHint(null);

    if (event.shiftKey && anchorId) {
      const from = fields.findIndex((field) => field.id === anchorId);
      const to = fields.findIndex((field) => field.id === id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        setSelectedIds(fields.slice(start, end + 1).map((field) => field.id));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
      );
      setAnchorId(id);
      return;
    }

    selectOnly(id);
  }

  /**
   * Atalhos de teclado da lista de campos. Ficam neste componente de
   * propósito: ele só existe na aba "Editor", então Ctrl+Z não some com o
   * texto de quem está na aba "Ver como JSON".
   *
   * Três guardas antes de qualquer coisa: foco fora de campo de digitação
   * (mesma regra dos atalhos numéricos do `WindowDock`), nenhum modal aberto
   * (o diálogo de confirmação também escuta o teclado) e nenhum arraste em
   * curso (as setas são do `KeyboardSensor` enquanto ele está no comando).
   */
  useEffect(() => {
    if (!shortcutsEnabled || dragging) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(document.activeElement)) return;

      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() !== "z" || event.altKey) return;
        event.preventDefault();
        /* A recusa que estava na tela é sobre um estado que acabou de deixar
           de existir — deixá-la ali faria parecer que o desfazer falhou. */
        setHint(null);
        if (event.shiftKey) {
          if (canRedo) onRedo();
        } else if (canUndo) {
          onUndo();
        }
        return;
      }

      if (event.altKey || event.shiftKey) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (fields.length === 0) return;
        event.preventDefault();
        /* Anda a partir da âncora; se ela não existe mais (ou nunca existiu),
           a primeira seta entra pela ponta correspondente da lista. */
        const at = fields.findIndex((field) => field.id === anchorId);
        const next =
          event.key === "ArrowDown"
            ? at < 0
              ? 0
              : Math.min(fields.length - 1, at + 1)
            : at < 0
              ? fields.length - 1
              : Math.max(0, at - 1);
        const target = fields[next];
        selectOnly(target.id);
        listRef.current
          ?.querySelector(`[data-field-id="${target.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (!canAdd || selection.length === 0) return;
        event.preventDefault();
        /* O mesmo diálogo de atrito do `×` do Inspetor — o atalho encurta o
           caminho até a pergunta, não pula a pergunta. */
        if (selection.length === 1) onRemove(selection[0]);
        else onRemoveMany(selection);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    shortcutsEnabled,
    dragging,
    fields,
    anchorId,
    selection,
    canAdd,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onRemove,
    onRemoveMany,
  ]);

  /** Mesma flag para todos os selecionados, numa aplicação só. */
  function setFlagOnSelection(key: FlagKey, value: boolean) {
    const target = new Set(selection.map((field) => field.id));
    onApplyFields(
      fields.map((field) => (target.has(field.id) ? { ...field, [key]: value } : field)),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = fields.findIndex((field) => field.id === active.id);
    const to = fields.findIndex((field) => field.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(fields, from, to).map((field) => field.id));
  }

  return (
    <div className="module-builder__panes">
      <section className="module-builder__pane module-builder__pane--fields">
        <header className="module-builder__pane-head">
          <h3 className="module-builder__pane-title">Campos</h3>
          {canAdd && (
            <button
              className="module-builder__pane-add"
              type="button"
              title="Novo campo"
              aria-label="Novo campo"
              onClick={onAdd}
            >
              +
            </button>
          )}
        </header>

        {fields.length === 0 ? (
          <p className="module-builder__empty">Este módulo não tem campos cadastrados.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragCancel={() => setDragging(false)}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={fields.map((field) => field.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="module-builder__field-rows" ref={listRef}>
                {fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    selected={selectedIds.includes(field.id)}
                    canEdit={canEdit}
                    onSelect={handlePick}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        <p className="module-builder__pane-foot">
          {canEdit
            ? "Arraste pela alça para mudar a ordem — é a mesma da tabela, da ficha e do formulário. Setas ↑↓ mudam a seleção, Shift e Ctrl no clique selecionam vários, Delete remove e Ctrl+Z desfaz."
            : "Este módulo não aceita edição de campos."}
        </p>
      </section>

      <section className="module-builder__pane module-builder__pane--preview">
        <header className="module-builder__pane-head">
          <h3 className="module-builder__pane-title">Prévia — {module.label}</h3>
          <span className="module-builder__pane-sub">a tabela do módulo publicado</span>
        </header>

        <div className="module-builder__pane-body">
          <TablePreview
            key={module.id}
            module={module}
            fields={fields}
            branchId={branchId}
            enabled={canViewRecords}
            selectedField={selectedField}
            onSelectField={selectOnly}
          />
        </div>
      </section>

      <section className="module-builder__pane module-builder__pane--inspector">
        <header className="module-builder__pane-head">
          <h3 className="module-builder__pane-title">Inspetor</h3>
          {selectedField ? (
            <span className="module-builder__pane-sub">{selectedField.label}</span>
          ) : (
            selection.length > 1 && (
              <span className="module-builder__pane-sub">em lote</span>
            )
          )}
        </header>

        {selectedField ? (
          <FieldInspector
            key={selectedField.id}
            field={selectedField}
            canAdd={canAdd}
            canEdit={canEdit}
            referenceChoices={referenceChoices}
            referenceLabel={
              selectedField.referenceModuleId
                ? (moduleLabels[selectedField.referenceModuleId] ??
                  selectedField.referenceModuleId)
                : null
            }
            onRemove={onRemove}
            onPatch={onPatch}
            hint={hint}
            onHint={setHint}
          />
        ) : selection.length > 1 ? (
          <BatchInspector
            selection={selection}
            canAdd={canAdd}
            canEdit={canEdit}
            onSetFlag={setFlagOnSelection}
            onRemoveMany={onRemoveMany}
            hint={hint}
            onHint={setHint}
          />
        ) : (
          <p className="module-builder__empty">
            Selecione um campo — na lista ao lado ou pelo cabeçalho de uma coluna da prévia — para
            editar. Shift ou Ctrl no clique seleciona vários.
          </p>
        )}
      </section>
    </div>
  );
}
