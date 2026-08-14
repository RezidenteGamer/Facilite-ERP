import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "../icons";
import "./LookupModal.css";

type LookupModalProps<T> = {
  title: string;
  placeholder?: string;
  onClose: () => void;
  onSelect: (item: T) => void;
  fetchItems: (query: string) => Promise<T[]>;
  getKey: (item: T) => string;
  renderItem: (item: T) => { primary: string; secondary?: string };
};

/**
 * Modal de busca genérico — usado pelos campos com lupa (Cliente, Vendedor,
 * Produto). Busca com debounce a cada digitação; a consulta em si (SQL) fica
 * a cargo de quem usa o componente via `fetchItems`.
 */
export default function LookupModal<T>({
  title,
  placeholder = "Buscar...",
  onClose,
  onSelect,
  fetchItems,
  getKey,
  renderItem,
}: LookupModalProps<T>) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      fetchItems(query)
        .then((result) => {
          if (cancelled) return;
          setItems(result);
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
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, fetchItems]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="lookup-modal__overlay">
          <Dialog.Content
            className="lookup-modal"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <Dialog.Title className="lookup-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            <div className="lookup-modal__search">
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                placeholder={placeholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="lookup-modal__results">
              {loading && <p className="lookup-modal__hint">Buscando...</p>}
              {!loading && error && <p className="lookup-modal__hint lookup-modal__hint--error">{error}</p>}
              {!loading && !error && items.length === 0 && (
                <p className="lookup-modal__hint">Nenhum resultado encontrado.</p>
              )}
              {!loading &&
                !error &&
                items.map((item) => {
                  const { primary, secondary } = renderItem(item);
                  return (
                    <button
                      key={getKey(item)}
                      type="button"
                      className="lookup-modal__result"
                      onClick={() => onSelect(item)}
                    >
                      <span className="lookup-modal__result-primary">{primary}</span>
                      {secondary && <span className="lookup-modal__result-secondary">{secondary}</span>}
                    </button>
                  );
                })}
            </div>

            <button className="lookup-modal__cancel" type="button" onClick={onClose}>
              Cancelar
            </button>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
