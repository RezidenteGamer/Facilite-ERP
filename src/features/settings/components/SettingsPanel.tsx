import { SearchIcon } from "../../../components/icons";
import BranchesSection from "./BranchesSection";
import DiscountCapSection from "./DiscountCapSection";
import SimplesCreditSection from "./SimplesCreditSection";
import StockPolicySection from "./StockPolicySection";
import "./SettingsPanel.css";

const ACTIONS = [
  { id: "parametros", label: "Parâmetros" },
  { id: "configuracoes-sistema", label: "Configurações do sistema" },
];

/** Cartão central da tela de Configurações — só visual por enquanto. */
export default function SettingsPanel() {
  return (
    <div className="settings-panel">
      <label className="settings-panel__label" htmlFor="settings-search">
        Busque uma configuração
      </label>
      <div className="settings-panel__search">
        <span className="settings-panel__search-icon">
          <SearchIcon />
        </span>
        <input id="settings-search" type="search" placeholder="" />
      </div>

      <div className="settings-panel__actions">
        {ACTIONS.map((action) => (
          <button key={action.id} className="settings-panel__btn" type="button" data-action={action.id}>
            {action.label}
          </button>
        ))}
      </div>

      {/* Seções reais do painel. A busca e os dois botões acima continuam
          decorativos (nenhum `onChange`/`onClick`) — mexer neles não faz parte
          de D1, e a separação "botão de cima = enfeite, seção de baixo =
          coisa que funciona" é hoje a única pista visível disso. */}
      <BranchesSection />
      <StockPolicySection />
      <SimplesCreditSection />
      <DiscountCapSection />
    </div>
  );
}
