import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useState } from "react";
import FormField from "../../components/form/FormField";
import LookupModal from "../../components/form/LookupModal";
import {
  fetchReturnableSaleDetail,
  fetchReturnableSales,
  type ReturnableSale,
  type ReturnableSaleDetail,
} from "../../lib/repositories/saleReturnsRepository";
import "../registry-engine/RegistryFormModal.css";
import "./SaleReturnModal.css";
import {
  computeReturnLineTotal,
  formatQuantity,
  formatReturnDate,
  formatReturnTotal,
  parseQuantity,
} from "./saleReturns";
import { extractErrorMessage } from "./useInvoicesData";

type SaleReturnModalProps = {
  branchId: string;
  onSubmit: (input: { saleId: string; reason: string; items: { saleItemId: string; quantity: number }[] }) => Promise<void>;
  onDone: () => void;
};

/**
 * Criação de uma devolução: escolher a venda de origem → escolher quais itens
 * e quantidades voltam → motivo → confirmar.
 *
 * **Modal feito à mão, não o motor genérico** — mesmo critério já usado no
 * `FinanceEntryPlanModal`: isto não é "um registro com campos", é uma lista
 * derivada de outro registro, com um teto por linha e uma prévia de valor
 * calculada ao vivo. Passar isso pelo `RegistryFormModal` exigiria um terceiro
 * prop de ponte só para este módulo — exatamente o sinal de que o motor
 * estaria se distorcendo para caber um caso.
 *
 * Também **não** é o motor de lote (`RegistryBatchFormModal`): as linhas aqui
 * não são lançamentos independentes que o operador acumula, são as linhas da
 * venda escolhida — ele não escolhe *o que* entra na lista, só *quanto* de
 * cada uma volta.
 */
export default function SaleReturnModal({ branchId, onSubmit, onDone }: SaleReturnModalProps) {
  const [sale, setSale] = useState<ReturnableSaleDetail | null>(null);
  const [saleLabel, setSaleLabel] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [loadingSale, setLoadingSale] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchSales = useCallback((query: string) => fetchReturnableSales(branchId, query), [branchId]);

  async function handlePickSale(picked: ReturnableSale) {
    setLookupOpen(false);
    setErrors([]);
    setQuantities({});
    setSaleLabel(`${picked.code} — ${picked.clientName}`);
    setLoadingSale(true);
    try {
      setSale(await fetchReturnableSaleDetail(picked.id));
    } catch (err) {
      setSale(null);
      setErrors([extractErrorMessage(err, "Erro ao carregar a venda escolhida.")]);
    } finally {
      setLoadingSale(false);
    }
  }

  const lines = (sale?.items ?? []).map((item) => {
    const typed = quantities[item.saleItemId] ?? "";
    const quantity = parseQuantity(typed);
    const invalid = typed.trim() !== "" && quantity === null;
    const overLimit = quantity !== null && quantity > item.remainingQuantity;
    const total =
      quantity !== null && quantity > 0 && !overLimit && sale
        ? computeReturnLineTotal({
            unitPrice: item.unitPrice,
            soldQuantity: item.quantity,
            itemDiscount: item.discountAmount,
            returnQuantity: quantity,
            saleSubtotal: sale.saleSubtotal,
            saleDiscount: sale.saleDiscount,
          })
        : 0;
    return { item, typed, quantity, invalid, overLimit, total };
  });

  const previewTotal = lines.reduce((sum, line) => sum + line.total, 0);

  async function handleSubmit() {
    if (!sale) {
      setErrors(["Escolha a venda que está sendo devolvida."]);
      return;
    }

    const problems: string[] = [];
    const items: { saleItemId: string; quantity: number }[] = [];

    for (const line of lines) {
      if (line.typed.trim() === "") continue;
      if (line.invalid) {
        problems.push(`${line.item.productDescription}: quantidade precisa ser um número válido.`);
        continue;
      }
      if (line.quantity === null || line.quantity <= 0) {
        problems.push(`${line.item.productDescription}: quantidade precisa ser maior que zero.`);
        continue;
      }
      if (line.overLimit) {
        problems.push(
          `${line.item.productDescription}: só restam ${formatQuantity(line.item.remainingQuantity)} para devolver ` +
            `(vendidos ${formatQuantity(line.item.quantity)}, já devolvidos ${formatQuantity(line.item.returnedQuantity)}).`,
        );
        continue;
      }
      items.push({ saleItemId: line.item.saleItemId, quantity: line.quantity });
    }

    if (items.length === 0 && problems.length === 0) {
      problems.push("Informe a quantidade devolvida de ao menos um item.");
    }
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }

    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({ saleId: sale.saleId, reason: reason.trim(), items });
      onDone();
    } catch (err) {
      setErrors([extractErrorMessage(err, "Não foi possível registrar a devolução.")]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal sale-return-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Devolver venda</p>
            </Dialog.Title>

            {errors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            <div className="registry-form-modal__fields">
              <FormField
                id="sale-return-sale"
                label="Venda de origem *"
                value={saleLabel}
                /* Só o modal de busca muda o valor — digitar não faz nada, de
                   propósito (mesma nota do `lookupField` do RegistryFormModal).
                   `disabled` não serve aqui: ele desabilita junto o botão da
                   lupa, que é o único caminho para escolher a venda. */
                onChange={() => {}}
                lookup
                onLookup={() => setLookupOpen(true)}
                hint="Busque pelo código da venda ou pelo nome do cliente."
              />
            </div>

            {loadingSale && <p className="sale-return-modal__hint">Carregando os itens da venda...</p>}

            {sale && !loadingSale && (
              <>
                <p className="sale-return-modal__hint">
                  Venda {sale.saleCode} · {sale.clientName} · emitida em {formatReturnDate(sale.issueDate)}
                </p>

                <div className="sale-return-modal__lines">
                  <div className="sale-return-modal__line sale-return-modal__line--head">
                    <span>Produto</span>
                    <span>Vendido</span>
                    <span>Já devolvido</span>
                    <span>Devolver</span>
                    <span>Valor</span>
                  </div>

                  {lines.map((line) => (
                    <div
                      key={line.item.saleItemId}
                      className={`sale-return-modal__line${
                        line.item.remainingQuantity <= 0 ? " sale-return-modal__line--exhausted" : ""
                      }`}
                    >
                      <span className="sale-return-modal__product">
                        {line.item.productCode} — {line.item.productDescription}
                      </span>
                      <span>{formatQuantity(line.item.quantity)}</span>
                      <span>{formatQuantity(line.item.returnedQuantity)}</span>
                      <span>
                        <input
                          className={`sale-return-modal__qty${
                            line.invalid || line.overLimit ? " sale-return-modal__qty--error" : ""
                          }`}
                          type="text"
                          inputMode="decimal"
                          aria-label={`Quantidade a devolver de ${line.item.productDescription}`}
                          value={line.typed}
                          disabled={line.item.remainingQuantity <= 0}
                          placeholder={line.item.remainingQuantity <= 0 ? "—" : `até ${formatQuantity(line.item.remainingQuantity)}`}
                          onChange={(event) =>
                            setQuantities((current) => ({
                              ...current,
                              [line.item.saleItemId]: event.target.value,
                            }))
                          }
                        />
                      </span>
                      <span>{formatReturnTotal(line.total)}</span>
                    </div>
                  ))}
                </div>

                <p className="sale-return-modal__total">Total a devolver: {formatReturnTotal(previewTotal)}</p>

                <div className="registry-form-modal__fields">
                  <FormField id="sale-return-reason" label="Motivo" value={reason} onChange={setReason} />
                </div>
              </>
            )}

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onDone}
                disabled={submitting}
              >
                Voltar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !sale}
              >
                {submitting ? "Devolvendo..." : "Confirmar devolução"}
              </button>
            </div>

            {/* Renderizado dentro do Dialog.Content (não como irmão do Root) —
                é assim que o Radix empilha um modal sobre outro sem o de baixo
                interpretar o clique como "clicou fora". Mesma nota já
                registrada no `lookupField` do RegistryFormModal. */}
            {lookupOpen && (
              <LookupModal<ReturnableSale>
                title="Buscar venda"
                placeholder="Código da venda ou cliente"
                onClose={() => setLookupOpen(false)}
                onSelect={handlePickSale}
                fetchItems={fetchSales}
                getKey={(item) => item.id}
                renderItem={(item) => ({
                  primary: `${item.code} — ${item.clientName}`,
                  secondary: `${formatReturnDate(item.issueDate)} · ${formatReturnTotal(item.total)}`,
                })}
              />
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
