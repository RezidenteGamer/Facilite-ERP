import { CheckIcon } from "../../../components/icons";
import type { StepId } from "../wizardSteps";
import "./WizardProgressBar.css";

type WizardProgressBarProps = {
  steps: { id: StepId; label: string }[];
  currentStep: StepId;
  visitedSteps: Set<StepId>;
  onJump: (step: StepId) => void;
};

/**
 * Barra de progresso do wizard — puramente visual, não depende de `useSaleDraft`.
 * Clicar numa etapa já visitada volta pra ela; etapas futuras não são clicáveis
 * (não dá pra "pular a fila" clicando à frente).
 */
export default function WizardProgressBar({ steps, currentStep, visitedSteps, onJump }: WizardProgressBarProps) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);
  const fillPercent = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 0;

  return (
    <nav className="wizard-progress" aria-label="Progresso da venda">
      <div className="wizard-progress__track">
        <div className="wizard-progress__track-fill" style={{ width: `${fillPercent}%` }} />
      </div>
      <ol className="wizard-progress__list">
        {steps.map((step, index) => {
          const isDone = index < currentIndex;
          const isCurrent = step.id === currentStep;
          const isClickable = visitedSteps.has(step.id) && !isCurrent;
          const state = isDone ? "done" : isCurrent ? "current" : "upcoming";

          return (
            <li key={step.id} className={`wizard-progress__item wizard-progress__item--${state}`}>
              {isClickable ? (
                <button
                  type="button"
                  className="wizard-progress__marker"
                  onClick={() => onJump(step.id)}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={`Voltar para ${step.label}`}
                >
                  {isDone ? <CheckIcon aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}
                </button>
              ) : (
                <span
                  className="wizard-progress__marker"
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isDone ? <CheckIcon aria-hidden="true" /> : <span aria-hidden="true">{index + 1}</span>}
                </span>
              )}
              <span className="wizard-progress__label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
