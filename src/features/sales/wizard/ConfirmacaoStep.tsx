import { formatMoney } from "../sales";
import type { useSaleDraft } from "../useSaleDraft";
import type { SaleIntent } from "../SaleWizard";
import "../SalePage.css";

type ConfirmacaoStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
  canCreate: boolean;
  onConfirmed: (intent: SaleIntent) => void;
};

/**
 * Etapa 6: aqui é onde a venda vira registro de verdade — "Salvar Venda" e
 * "Gerar Nota Fiscal" gravam exatamente a mesma coisa (não existe emissão
 * fiscal real no sistema ainda); a diferença é só a mensagem/atalho na tela
 * de sucesso depois. Substitui o antigo modal de confirmação — esta etapa
 * já É a confirmação, um popup em cima dela seria atrito redundante.
 */
export default function ConfirmacaoStep({ draft, canCreate, onConfirmed }: ConfirmacaoStepProps) {
  const disabled = !draft.canConfirm || !canCreate || draft.submitting;

  function handleConfirm(intent: SaleIntent) {
    onConfirmed(intent);
    draft.confirmSale();
  }

  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Confirmação</p>

        <p className="sale__confirm-warning">
          Total {formatMoney(draft.total)} — esta ação grava a venda e baixa o estoque dos produtos.
        </p>

        {draft.submitError && <p className="sale__error">{draft.submitError}</p>}
        {!canCreate && <p className="sale__error">Você não tem permissão para confirmar vendas.</p>}

        <div className="sale__confirm-actions">
          <button
            className="sale__continue"
            type="button"
            disabled={disabled}
            onClick={() => handleConfirm("venda")}
          >
            {draft.submitting ? "Confirmando..." : "Salvar Venda"}
          </button>
          <button
            className="sale__continue sale__continue--secondary"
            type="button"
            disabled={disabled}
            onClick={() => handleConfirm("nota")}
          >
            {draft.submitting ? "Confirmando..." : "Gerar Nota Fiscal"}
          </button>
        </div>
      </div>
    </div>
  );
}
