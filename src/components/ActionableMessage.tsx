import { useNavigate } from "react-router-dom";
import "./ActionableMessage.css";

export type ActionableMessageAction = {
  label: string;
  to: string;
};

type ActionableMessageProps = {
  message: string;
  action?: ActionableMessageAction;
  className?: string;
};

/**
 * Mensagem de erro/aviso com uma ação "para onde ir" opcional. Primeiro uso:
 * SalePage.tsx (regra fiscal não cadastrada) e ConfirmacaoStep.tsx (estoque
 * insuficiente) — ver AGENTS.md. Sem action, renderiza só o texto.
 */
export default function ActionableMessage({ message, action, className }: ActionableMessageProps) {
  const navigate = useNavigate();

  return (
    <p className={className}>
      {message}
      {action && (
        <>
          {" "}
          <button
            type="button"
            className="actionable-message__action"
            onClick={() => navigate(action.to)}
          >
            {action.label} →
          </button>
        </>
      )}
    </p>
  );
}
