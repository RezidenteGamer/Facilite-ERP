import { useState } from "react";
import WizardProgressBar from "./wizard/WizardProgressBar";
import ClienteStep from "./wizard/ClienteStep";
import ProdutosStep from "./wizard/ProdutosStep";
import DetalhesStep from "./wizard/DetalhesStep";
import FaturamentoStep from "./wizard/FaturamentoStep";
import RevisaoStep from "./wizard/RevisaoStep";
import ConfirmacaoStep from "./wizard/ConfirmacaoStep";
import { WIZARD_STEPS, type StepId } from "./wizardSteps";
import type { useSaleDraft } from "./useSaleDraft";
import "./SalePage.css";
import "./SaleWizard.css";

/** "nota" pede emissão de NF-e junto da confirmação — ver `ConfirmacaoStep.tsx`/`useSaleDraft.confirmSale`. */
export type SaleIntent = "venda" | "nota";

type SaleWizardProps = {
  draft: ReturnType<typeof useSaleDraft>;
  branchId: string | null;
  canCreate: boolean;
  onConfirmed: (intent: SaleIntent) => void;
};

/** Casca do wizard: dona da etapa atual, decide quando dá pra avançar, monta a barra de progresso + a etapa ativa. */
export default function SaleWizard({ draft, branchId, canCreate, onConfirmed }: SaleWizardProps) {
  const [currentStep, setCurrentStep] = useState<StepId>("cliente");
  const [visitedSteps, setVisitedSteps] = useState<Set<StepId>>(() => new Set(["cliente"]));

  const currentIndex = WIZARD_STEPS.findIndex((step) => step.id === currentStep);

  // Deriva das mesmas regras que já existiam em useSaleDraft (headerValid,
  // paymentsMatch, canConfirm) — não duplica validação nova, só decide em
  // que ponto do fluxo cada uma já se aplica.
  const canAdvance: Record<StepId, boolean> = {
    cliente: draft.headerValid,
    produtos: draft.cart.length > 0,
    detalhes: true,
    faturamento: draft.payments.length > 0 && draft.paymentsMatch,
    revisao: true,
    confirmacao: draft.canConfirm,
  };

  function goToStep(step: StepId) {
    setCurrentStep(step);
    setVisitedSteps((current) => new Set(current).add(step));
  }

  function goNext() {
    const next = WIZARD_STEPS[currentIndex + 1];
    if (next) goToStep(next.id);
  }

  function goBack() {
    const previous = WIZARD_STEPS[currentIndex - 1];
    if (previous) goToStep(previous.id);
  }

  function jumpTo(step: StepId) {
    if (visitedSteps.has(step)) setCurrentStep(step);
  }

  return (
    <div className={`sale-wizard${currentStep === "produtos" ? " sale-wizard--wide" : ""}`}>
      <WizardProgressBar
        steps={WIZARD_STEPS}
        currentStep={currentStep}
        visitedSteps={visitedSteps}
        onJump={jumpTo}
      />

      <div className="sale-wizard__step">
        {currentStep === "cliente" && <ClienteStep draft={draft} />}
        {currentStep === "produtos" && <ProdutosStep draft={draft} branchId={branchId} />}
        {currentStep === "detalhes" && <DetalhesStep draft={draft} />}
        {currentStep === "faturamento" && <FaturamentoStep draft={draft} />}
        {currentStep === "revisao" && <RevisaoStep draft={draft} />}
        {currentStep === "confirmacao" && (
          <ConfirmacaoStep draft={draft} canCreate={canCreate} onConfirmed={onConfirmed} />
        )}
      </div>

      <div className="sale-wizard__nav">
        {currentIndex > 0 && (
          <button className="sale__back" type="button" onClick={goBack}>
            Voltar
          </button>
        )}
        {currentStep !== "confirmacao" && (
          <button
            className="sale__continue sale-wizard__nav-next"
            type="button"
            disabled={!canAdvance[currentStep]}
            onClick={goNext}
          >
            {currentStep === "revisao" ? "Continuar" : "Próximo"}
          </button>
        )}
      </div>
    </div>
  );
}
