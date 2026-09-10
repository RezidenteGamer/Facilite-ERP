import { useNavigate } from "react-router-dom";

type SettingsLinkSectionProps = {
  /** Rótulo do grupo (ex.: "Filiais", "Vendas"). */
  title: string;
  label: string;
  hint: string;
  to: string;
  /** Quem não pode entrar vê o botão **desabilitado**, nunca escondido. */
  allowed: boolean;
  deniedMessage: string;
};

/**
 * Seção do painel de Configurações que só leva a outra tela (D1, 09/09/2026).
 *
 * Diferente de `StockPolicySection` e `SimplesCreditSection`, que **editam** um
 * parâmetro aqui mesmo, esta é uma placa: o cadastro mora noutro lugar, e o
 * problema que ela resolve é o operador procurar em Configurações e não achar.
 *
 * Existe como componente, e não como duas cópias, porque nasceu duas vezes na
 * mesma tarefa (Filiais e o teto de desconto em Permissões) — e a segunda cópia
 * é onde a primeira começa a divergir.
 *
 * O botão desabilitado em vez de escondido segue a regra das outras seções
 * deste painel: esconder faria quem não tem permissão concluir que a tela não
 * existe.
 */
export default function SettingsLinkSection({
  title,
  label,
  hint,
  to,
  allowed,
  deniedMessage,
}: SettingsLinkSectionProps) {
  const navigate = useNavigate();

  return (
    <div className="settings-panel__section">
      <p className="settings-panel__section-title">{title}</p>

      <div className="settings-panel__row">
        <div className="settings-panel__row-text">
          <span className="settings-panel__row-label">{label}</span>
          <span className="settings-panel__row-hint">{hint}</span>
        </div>

        <div className="settings-panel__field">
          <button
            className="settings-panel__btn"
            type="button"
            disabled={!allowed}
            onClick={() => navigate(to)}
          >
            Abrir
          </button>
        </div>
      </div>

      {!allowed && <p className="settings-panel__row-hint">{deniedMessage}</p>}
    </div>
  );
}
