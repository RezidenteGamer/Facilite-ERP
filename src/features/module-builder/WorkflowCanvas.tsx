import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { ModuleSituation, ModuleTransition } from "../modules/moduleWorkflow";
import "./ModuleBuilderPage.css";

/* Identidade estável das opções de sensor (pegadinha de Realizar Venda). O
   arraste de um nó é livre, não ordenado, então basta mouse e toque — não há
   "próxima posição" para o teclado navegar num plano contínuo. */
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 200, tolerance: 8 } };

/** Tamanho do nó, em px — o mesmo número serve ao CSS, ao recorte da seta e ao layout inicial. */
const NODE_W = 176;
const NODE_H = 64;
const COLS = 4;

export type Selection =
  | { kind: "situation"; id: string }
  | { kind: "transition"; id: string }
  | null;

type WorkflowCanvasProps = {
  situations: ModuleSituation[];
  transitions: ModuleTransition[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Arrastar um nó grava a posição — só isso, nada de rótulo ou situação inicial. */
  onMoveSituation: (id: string, x: number, y: number) => void;
  /** Os dois nós escolhidos no modo "ligar" viram uma transição nova. */
  onConnect: (fromId: string, toId: string) => void;
  /** Painel lateral do que estiver selecionado — montado por quem usa o canvas. */
  panel: ReactNode;
};

/**
 * Posição do nó no plano.
 *
 * `canvas_x`/`canvas_y` são nuláveis de propósito: toda situação criada antes
 * desta etapa tem nulo, e recusar desenhar por causa disso deixaria o
 * diagrama vazio justamente para quem já tem workflow montado. Nulo cai numa
 * linha horizontal pela ordem de `sort_order` (quebrando a cada quatro nós
 * para não sair da tela), que é exatamente a leitura que a lista antiga dava.
 * O primeiro arraste substitui o cálculo por um valor gravado.
 */
function positionOf(situation: ModuleSituation, index: number) {
  return {
    x: situation.canvasX ?? 32 + (index % COLS) * (NODE_W + 40),
    y: situation.canvasY ?? 36 + Math.floor(index / COLS) * (NODE_H + 70),
  };
}

/**
 * Onde a seta encosta no nó: o ponto em que a reta centro→centro cruza a
 * borda do retângulo. Sem isso a ponta da seta fica escondida debaixo da
 * caixa e o sentido — a única informação que uma transição tem — some.
 */
function borderPoint(cx: number, cy: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : NODE_W / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : NODE_H / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

type NodeProps = {
  situation: ModuleSituation;
  x: number;
  y: number;
  selected: boolean;
  connectRole: "none" | "source" | "candidate";
  /** Verdadeiro logo depois de um arraste — ver o comentário do clique abaixo. */
  justDragged: () => boolean;
  onActivate: () => void;
};

function SituationNode({
  situation,
  x,
  y,
  selected,
  connectRole,
  justDragged,
  onActivate,
}: NodeProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: situation.id,
  });

  /* O `click` nativo dispara depois do `mouseup` mesmo quando houve arraste, e
     o dnd-kit não o cancela. Sem a janela de `justDragged`, largar um nó
     acabaria selecionando-o — ou, no modo "ligar", criando uma transição que
     ninguém pediu. O carimbo vem do `onDragEnd` do contexto, que roda no
     `mouseup`, antes do `click`. */
  const className = [
    "module-builder__node",
    selected ? "module-builder__node--selected" : "",
    situation.isInitial ? "module-builder__node--initial" : "",
    connectRole === "source" ? "module-builder__node--connect-from" : "",
    connectRole === "candidate" ? "module-builder__node--connect-to" : "",
    isDragging ? "module-builder__node--dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={className}
      style={{
        left: x,
        top: y,
        width: NODE_W,
        height: NODE_H,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
      onClick={() => {
        if (justDragged()) return;
        onActivate();
      }}
      {...attributes}
      {...listeners}
    >
      <span className="module-builder__node-label">{situation.label}</span>
      <span className="module-builder__node-code">{situation.code}</span>
      {situation.isInitial && <span className="module-builder__node-seal">inicial</span>}
    </button>
  );
}

/**
 * O workflow como diagrama: cada situação é um nó posicionável, cada
 * transição é uma seta com o sentido certo (de → para).
 *
 * **Como se cria uma transição, e por quê.** A escolha era livre (arrastar de
 * um nó até o outro, ou clicar num e depois no outro) e não havia precedente
 * no projeto para copiar. Ficou **clicar em um e depois no outro**, com um
 * modo "Ligar situações" que se arma antes:
 *
 * - o arraste do nó já está ocupado — é como se move a caixa, e é o gesto que
 *   a etapa acabou de gravar no banco. Um segundo arraste no mesmo elemento
 *   precisaria de uma alça pequena só para isso, e alça pequena com dnd-kit é
 *   exatamente o caso que exigiu trocar `rectIntersection` por `pointerWithin`
 *   em Ajuste de estoque: colisão imprecisa perto de alvo pequeno;
 * - o modo armado deixa o estado visível ("agora um clique liga"), o que um
 *   arraste não deixa — e é cancelável com `Esc` ou clicando no fundo;
 * - funciona igual no toque, sem depender de precisão de arraste.
 *
 * O preço é um clique a mais para armar o modo. É o preço certo para uma ação
 * que cria uma linha no banco.
 */
export default function WorkflowCanvas({
  situations,
  transitions,
  selection,
  onSelect,
  onMoveSituation,
  onConnect,
  panel,
}: WorkflowCanvasProps) {
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const dragEndAt = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
  );

  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    situations.forEach((situation, index) => {
      map[situation.id] = positionOf(situation, index);
    });
    return map;
  }, [situations]);

  const contentWidth = Math.max(
    680,
    ...Object.values(positions).map((position) => position.x + NODE_W + 40),
  );
  const contentHeight = Math.max(
    280,
    ...Object.values(positions).map((position) => position.y + NODE_H + 40),
  );

  function handleDragEnd(event: DragEndEvent) {
    dragEndAt.current = Date.now();
    const id = String(event.active.id);
    const current = positions[id];
    if (!current) return;
    const x = Math.max(0, Math.round(current.x + event.delta.x));
    const y = Math.max(0, Math.round(current.y + event.delta.y));
    if (x === current.x && y === current.y) return;
    onMoveSituation(id, x, y);
  }

  function stopConnecting() {
    setConnecting(false);
    setConnectFrom(null);
  }

  function handleNodeActivate(id: string) {
    if (!connecting) {
      onSelect({ kind: "situation", id });
      return;
    }
    if (!connectFrom) {
      setConnectFrom(id);
      return;
    }
    if (connectFrom === id) {
      /* De uma situação para ela mesma o banco recusa (`check (from <> to)`) —
         melhor tratar o segundo clique no mesmo nó como desistência. */
      setConnectFrom(null);
      return;
    }
    onConnect(connectFrom, id);
    stopConnecting();
  }

  const edges = transitions
    .map((transition) => {
      const from = positions[transition.fromSituationId];
      const to = positions[transition.toSituationId];
      if (!from || !to) return null;

      const c1 = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
      const c2 = { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 };
      const start = borderPoint(c1.x, c1.y, c2.x, c2.y);
      const end = borderPoint(c2.x, c2.y, c1.x, c1.y);

      /* Curva em vez de reta, com a barriga sempre para o mesmo lado da
         direção: assim A→B e B→A (que o banco permite, `unique` é por par
         ordenado) não se sobrepõem nem viram uma linha só. */
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const bow = 26;
      const control = {
        x: (start.x + end.x) / 2 + (-dy / length) * bow,
        y: (start.y + end.y) / 2 + (dx / length) * bow,
      };
      const mid = {
        x: (start.x + 2 * control.x + end.x) / 4,
        y: (start.y + 2 * control.y + end.y) / 4,
      };

      return {
        transition,
        d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
        mid,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

  return (
    <div className="module-builder__diagram">
      <div className="module-builder__diagram-bar">
        <button
          className={`module-builder__btn module-builder__btn--small${
            connecting ? " module-builder__btn--armed" : ""
          }`}
          type="button"
          disabled={situations.length < 2}
          onClick={() => (connecting ? stopConnecting() : setConnecting(true))}
        >
          {connecting ? "Cancelar ligação" : "Ligar situações"}
        </button>
        <span className="module-builder__diagram-hint">
          {connecting
            ? connectFrom
              ? "Agora clique na situação de destino."
              : "Clique na situação de origem."
            : situations.length < 2
              ? "Crie pelo menos duas situações para poder ligá-las."
              : "Arraste os nós para posicionar. Clique numa seta para ver e configurar as ações dela."}
        </span>
      </div>

      <div className="module-builder__diagram-body">
        <div
          className="module-builder__plane-scroll"
          onKeyDown={(event) => {
            if (event.key === "Escape") stopConnecting();
          }}
        >
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div
              className={`module-builder__plane${
                connecting ? " module-builder__plane--connecting" : ""
              }`}
              style={{ width: contentWidth, height: contentHeight }}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                onSelect(null);
                stopConnecting();
              }}
            >
              <svg
                className="module-builder__edges"
                width={contentWidth}
                height={contentHeight}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="wf-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>

                {edges.map((edge) => {
                  const selected =
                    selection?.kind === "transition" && selection.id === edge.transition.id;
                  return (
                    <g
                      key={edge.transition.id}
                      className={`module-builder__edge${
                        selected ? " module-builder__edge--selected" : ""
                      }`}
                      onClick={() => onSelect({ kind: "transition", id: edge.transition.id })}
                    >
                      {/* Traço grosso e invisível só para o clique: uma seta de
                          2px é um alvo pequeno demais para o ponteiro. */}
                      <path className="module-builder__edge-hit" d={edge.d} />
                      <path
                        className="module-builder__edge-line"
                        d={edge.d}
                        markerEnd="url(#wf-arrow)"
                      />
                      <text
                        className="module-builder__edge-label"
                        x={edge.mid.x}
                        y={edge.mid.y}
                        textAnchor="middle"
                      >
                        {edge.transition.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {situations.map((situation) => (
                <SituationNode
                  key={situation.id}
                  situation={situation}
                  x={positions[situation.id].x}
                  y={positions[situation.id].y}
                  selected={selection?.kind === "situation" && selection.id === situation.id}
                  connectRole={
                    !connecting
                      ? "none"
                      : connectFrom === situation.id
                        ? "source"
                        : "candidate"
                  }
                  justDragged={() => Date.now() - dragEndAt.current < 200}
                  onActivate={() => handleNodeActivate(situation.id)}
                />
              ))}
            </div>
          </DndContext>
        </div>

        <aside className="module-builder__panel">{panel}</aside>
      </div>
    </div>
  );
}
