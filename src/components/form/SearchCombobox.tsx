import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchIcon } from "../icons";
/* Reaproveita a cápsula branca do campo comum (rótulo + controle + dica):
   este é o mesmo campo de sempre, só que digitável e com sugestão — se ele
   tivesse CSS próprio para a moldura, as duas cópias sairiam do lugar na
   primeira mudança de tema ou de altura. */
import "./FormField.css";
import "./SearchCombobox.css";

type SearchComboboxProps<T> = {
  id: string;
  label: string;
  /** Texto do campo. É o mesmo contrato do `FormField`: quem usa é o dono do valor. */
  value: string;
  onChange: (value: string) => void;
  /** Chamado quando o operador escolhe um item da lista (clique ou Enter). */
  onSelect: (item: T) => void;
  /** Mesma função de busca que o `LookupModal` já recebia — nada muda no SQL. */
  fetchItems: (query: string) => Promise<T[]>;
  getKey: (item: T) => string;
  renderItem: (item: T) => { primary: string; secondary?: string };
  placeholder?: string;
  disabled?: boolean;
  /** Texto curto abaixo do campo — só para explicar algo não óbvio pelo rótulo. */
  hint?: string;
  /**
   * Sem esta prop a linha "Cadastrar novo" simplesmente não existe. É
   * opcional de propósito: nem todo campo de busca aponta para um cadastro
   * que faça sentido criar dali (Vendedor é um usuário do sistema; Venda de
   * origem e Grupo tributário não se criam no meio de outra operação).
   */
  onCreateNew?: (query: string) => void;
  createNewLabel?: string;
  /** Classe extra na raiz — para telas com visual proprio (ex.: o PDV). */
  className?: string;
  /**
   * Esconde o rotulo visualmente, sem tirar do acessivel. Para onde o rotulo
   * ja esta dito de outro jeito (no PDV, pelo placeholder do campo).
   */
  hideLabel?: boolean;
};

/** Mesmo tempo do `LookupModal`: uma consulta por pausa de digitação, não por tecla. */
const DEBOUNCE_MS = 250;

/**
 * Só abre para cima quando embaixo não cabe nem uma lista curta. O limiar é
 * baixo de propósito: virar a lista com espaço razoável embaixo desloca o
 * olhar sem motivo, e "quase caber" é resolvido encolhendo a altura.
 */
const MIN_HEIGHT_BELOW = 180;

type AnchorRect = { left: number; width: number; top: number; bottom: number };

/**
 * Campo de busca com sugestão em tempo real: o operador digita direto no
 * campo e escolhe na lista que abre embaixo, em vez de abrir um modal pela
 * lupa. Substitui o par "campo + `LookupModal`" em todos os campos de
 * consulta do sistema.
 *
 * A busca em si (SQL) continua a cargo de quem usa, via `fetchItems` — é a
 * mesma função que o `LookupModal` recebia, com o mesmo debounce.
 */
export default function SearchCombobox<T>({
  id,
  label,
  value,
  onChange,
  onSelect,
  fetchItems,
  getKey,
  renderItem,
  placeholder = "Digite para buscar...",
  disabled = false,
  hint,
  onCreateNew,
  createNewLabel = "Cadastrar novo",
  className,
  hideLabel = false,
}: SearchComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** -1 = nada destacado; só as setas põem o destaque, para o Enter não escolher sozinho. */
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Posição do campo na viewport — a lista é `fixed`, ver o porquê no `createPortal` abaixo. */
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* `fetchItems` fica num ref e **não** entra nas dependências do efeito:
     vários call sites passam uma seta inline (`(q) => fetchContactsByKind(...)`),
     cuja identidade muda a cada render — com ela na lista de dependências, cada
     resposta dispararia a busca seguinte, num laço que só o debounce disfarça.
     Quem manda buscar de novo é o termo digitado, não a identidade da função. */
  const fetchItemsRef = useRef(fetchItems);
  useEffect(() => {
    fetchItemsRef.current = fetchItems;
  });

  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const trimmed = value.trim();
  const showCreateNew = Boolean(onCreateNew) && !loading && !error && items.length === 0 && trimmed !== "";
  /** A linha "Cadastrar novo" é a última opção navegável, depois dos resultados. */
  const optionCount = items.length + (showCreateNew ? 1 : 0);

  // Mesma mecânica do `LookupModal`: espera a pausa de digitação, cancela a
  // resposta que chegar depois de o termo já ter mudado.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      fetchItemsRef
        .current(value)
        .then((result) => {
          if (cancelled) return;
          setItems(result);
          setActiveIndex(-1);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const message =
            err instanceof Error
              ? err.message
              : err && typeof err === "object" && "message" in err && typeof err.message === "string"
                ? err.message
                : "Erro ao buscar.";
          setError(message);
          setItems([]);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, value]);

  /* Mede o campo na viewport e acompanha rolagem/redimensionamento. O
     `scroll` é em captura porque quem rola pode ser um contêiner interno (o
     corpo rolável de um modal), não a janela. */
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    function measure() {
      const rect = controlRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({ left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  // Clicar fora fecha sem escolher. Em captura, e olhando também a lista, que
  // desde a portalização não é mais descendente do campo no DOM.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  /* Escape fecha só a sugestão, nunca o modal que hospeda o campo.
     Precisa ser aqui, em captura **no `window`**, e não no `onKeyDown` do
     input: o Radix escuta o Escape em captura no `document`, e captura no
     `window` é o primeiro alvo do caminho de propagação — parar ali é o único
     ponto que chega antes dele. Um `stopPropagation` no evento do React
     chegaria tarde demais, com o modal já fechado. */
  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  // Mantém o item destacado pelo teclado visível dentro da lista rolável.
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector(`#${CSS.escape(`${id}-option-${activeIndex}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function chooseIndex(index: number) {
    if (index < 0) return;
    if (index < items.length) {
      onSelect(items[index]);
      close();
      return;
    }
    if (showCreateNew) startCreateNew();
  }

  function startCreateNew() {
    close();
    onCreateNew?.(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (optionCount === 0) return;
      setActiveIndex((current) => (current + 1) % optionCount);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open || optionCount === 0) return;
      setActiveIndex((current) => (current <= 0 ? optionCount - 1 : current - 1));
      return;
    }

    if (event.key === "Enter") {
      if (!open || activeIndex < 0) return;
      event.preventDefault();
      chooseIndex(activeIndex);
      return;
    }

    /* Escape não aparece aqui: enquanto a lista está aberta ele é tratado
       antes, em captura no `window` — ver o efeito acima. */

    if (event.key === "Tab") close();
  }

  /* A lista vai para o `body`, e não para dentro do campo, por dois motivos
     que só aparecem quando o combobox mora num modal: o corpo do modal rola
     (`overflow-y: auto`, recortaria a lista) e ele tem `backdrop-filter`, que
     cria um containing block novo — o mesmo detalhe já documentado no
     `DragOverlay` do dnd-kit. Daí a posição `fixed` calculada à mão. */
  function renderDropdown() {
    if (!open || !anchor) return null;

    const spaceBelow = window.innerHeight - anchor.bottom;
    const flip = spaceBelow < MIN_HEIGHT_BELOW && anchor.top > spaceBelow;
    const available = (flip ? anchor.top : spaceBelow) - 16;

    return createPortal(
      <div
        ref={dropdownRef}
        className={`search-combobox__dropdown${flip ? " search-combobox__dropdown--above" : ""}`}
        style={{
          left: anchor.left,
          width: anchor.width,
          ...(flip
            ? { bottom: window.innerHeight - anchor.top + 6 }
            : { top: anchor.bottom + 6 }),
        }}
        /* Impede que o Radix leia o clique aqui como "clicou fora" e feche o
           modal que hospeda o campo — a lista está fora do `Dialog.Content`
           no DOM, então a contenção não a protege como protegia o
           `LookupModal` (que era um Dialog próprio, empilhado pelo Radix). */
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className="search-combobox__list"
          style={{ maxHeight: Math.max(140, Math.min(280, available)) }}
          id={listboxId}
          role="listbox"
          aria-label={label}
          ref={listRef}
        >
          {loading && <p className="search-combobox__hint">Buscando...</p>}

          {!loading && error && <p className="search-combobox__hint search-combobox__hint--error">{error}</p>}

          {!loading && !error && items.length === 0 && !showCreateNew && (
            <p className="search-combobox__hint">
              {trimmed ? `Nenhum resultado para "${trimmed}".` : "Nenhum resultado encontrado."}
            </p>
          )}

          {!loading &&
            !error &&
            items.map((item, index) => {
              const { primary, secondary } = renderItem(item);
              return (
                <button
                  key={getKey(item)}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`search-combobox__option${
                    index === activeIndex ? " search-combobox__option--active" : ""
                  }`}
                  /* Impede o blur do campo antes do clique registrar. */
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseIndex(index)}
                >
                  <span className="search-combobox__option-primary">{primary}</span>
                  {secondary && <span className="search-combobox__option-secondary">{secondary}</span>}
                </button>
              );
            })}

          {showCreateNew && (
            <button
              id={optionId(items.length)}
              type="button"
              role="option"
              aria-selected={items.length === activeIndex}
              className={`search-combobox__option search-combobox__option--create${
                items.length === activeIndex ? " search-combobox__option--active" : ""
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(items.length)}
              onClick={startCreateNew}
            >
              <span className="search-combobox__option-primary">Nenhum resultado para "{trimmed}"</span>
              <span className="search-combobox__option-create-cta">{createNewLabel}</span>
            </button>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className={`form-field search-combobox${className ? ` ${className}` : ""}`} ref={containerRef}>
      <label className={`form-field__label${hideLabel ? " search-combobox__label--hidden" : ""}`} htmlFor={id}>
        {label}
      </label>

      <div
        ref={controlRef}
        className={`form-field__control${disabled ? " form-field__control--disabled" : ""}`}
        onClick={() => {
          if (disabled) return;
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        <input
          ref={inputRef}
          id={id}
          className="form-field__input"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          /* Receber foco **não** abre a lista, de propósito: o Radix dá foco
             automático ao primeiro campo do modal, e um formulário que nasce
             com a sugestão aberta por cima dos outros campos é ruído. Abrem a
             lista o clique no campo, a digitação e a seta para baixo. */
          onFocus={(event) => {
            /* iOS Safari não redimensiona a viewport quando o teclado abre —
               sem isto, um campo perto do rodapé some atrás dele ao focar. */
            event.target.scrollIntoView({ block: "center", behavior: "smooth" });
          }}
          onKeyDown={handleKeyDown}
        />

        {/* Decorativo: a busca acontece ao digitar, não há mais o que clicar. */}
        <span className="search-combobox__icon" aria-hidden="true">
          <SearchIcon />
        </span>
      </div>

      {hint && <p className="form-field__hint">{hint}</p>}

      {renderDropdown()}
    </div>
  );
}
