import * as Dialog from "@radix-ui/react-dialog";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import ProductPickerPanel from "../../components/product-picker/ProductPickerPanel";
import type { Product } from "./products";
import "./StockAdjustModal.css";

// Sem droppable nesta modal — o produto é sempre escolhido por clique. O
// `DndContext` só existe porque `ProductPickerPanel` chama `useDraggable`
// internamente; sem `activationConstraint`, o próprio dnd-kit intercepta o
// clique simples como início de arraste (ver Realizar Venda, mesma solução).
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

type StockAdjustModalProps = {
  branchId: string | null;
  onSubmit: (input: { productId: string; change: number; reason: string }) => Promise<void>;
  onCancel: () => void;
};

/**
 * Modal do botão "Ajuste de estoque": escolher o produto (reaproveitando o
 * mesmo painel de busca/seleção de Realizar Venda) e informar quanto muda e
 * por quê. Sem edição/exclusão — é um lançamento novo, não um formulário de
 * cadastro.
 */
export default function StockAdjustModal({ branchId, onSubmit, onCancel }: StockAdjustModalProps) {
  const [product, setProduct] = useState<Product | null>(null);
  const [change, setChange] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  const changeValue = Number(change.replace(",", "."));
  const canSubmit = product !== null && Number.isFinite(changeValue) && changeValue !== 0 && reason.trim() !== "";

  async function handleSubmit() {
    if (!product || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ productId: product.id, change: changeValue, reason: reason.trim() });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err && typeof err.message === "string"
            ? err.message
            : "Não foi possível registrar o ajuste.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="stock-adjust-modal__overlay">
          <Dialog.Content className="stock-adjust-modal" aria-describedby={undefined}>
            <Dialog.Title className="stock-adjust-modal__title" asChild>
              <p>Ajuste de estoque</p>
            </Dialog.Title>

            {error && <p className="stock-adjust-modal__error">{error}</p>}

            <div className="stock-adjust-modal__body">
              <DndContext sensors={sensors}>
                <ProductPickerPanel branchId={branchId} onAddProduct={setProduct} />
              </DndContext>

              <div className="stock-adjust-modal__form">
                {product ? (
                  <p className="stock-adjust-modal__selected">
                    Produto: <strong>{product.description}</strong> (estoque atual: {product.stock})
                  </p>
                ) : (
                  <p className="stock-adjust-modal__hint">Selecione um produto na lista ao lado.</p>
                )}

                <FormField
                  id="stock-adjust-change"
                  label="Alteração (positivo para entrada, negativo para saída) *"
                  value={change}
                  onChange={setChange}
                  disabled={!product}
                />

                <FormField
                  id="stock-adjust-reason"
                  label="Motivo *"
                  value={reason}
                  onChange={setReason}
                  disabled={!product}
                />
              </div>
            </div>

            <div className="stock-adjust-modal__actions">
              <button
                className="stock-adjust-modal__btn stock-adjust-modal__btn--cancel"
                type="button"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancelar
              </button>
              <button
                className="stock-adjust-modal__btn stock-adjust-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
              >
                {submitting ? "Salvando..." : "Confirmar ajuste"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
