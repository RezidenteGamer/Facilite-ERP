import { useNavigate } from "react-router-dom";
import backIcon from "../assets/icons/voltar-sistema-geral.webp";
import { BACK_ICON_PLACEHOLDER } from "../assets/icons/voltar-sistema-geral.placeholder";
import FadeImage from "./FadeImage";
import "./FloatingTabs.css";

type BackTabProps = {
  /** Sobrepõe o "voltar no histórico" padrão — usado na home para confirmar saída. */
  onClick?: () => void;
};

/** Aba azul encostada na borda inferior esquerda — volta para a tela anterior. */
export default function BackTab({ onClick }: BackTabProps) {
  const navigate = useNavigate();

  return (
    <button
      className="floating-tab floating-tab--back"
      type="button"
      aria-label="Voltar"
      onClick={onClick ?? (() => navigate(-1))}
    >
      <FadeImage src={backIcon} alt="" placeholder={BACK_ICON_PLACEHOLDER} />
    </button>
  );
}
