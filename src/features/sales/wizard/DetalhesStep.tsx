import FormField from "../../../components/form/FormField";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

type DetalhesStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
};

/** Etapa 3: tudo opcional — nada aqui bloqueia avançar. */
export default function DetalhesStep({ draft }: DetalhesStepProps) {
  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Detalhes da operação (opcional)</p>

        <div className="sale__details-grid">
          <FormField
            id="venda-tipo-operacao"
            label="Tipo de operação"
            value={draft.header.tipoOperacao}
            onChange={(v) => draft.setField("tipoOperacao", v)}
          />
          <FormField
            id="venda-departamento"
            label="Departamento"
            value={draft.header.departamento}
            onChange={(v) => draft.setField("departamento", v)}
          />
          <FormField
            id="venda-endereco"
            label="Endereço"
            value={draft.header.endereco}
            onChange={(v) => draft.setField("endereco", v)}
          />
          <FormField
            id="venda-centro-custos"
            label="Centro de custos"
            value={draft.header.centroCustos}
            onChange={(v) => draft.setField("centroCustos", v)}
          />
          <FormField
            id="venda-endereco-entrega"
            label="Endereço de entrega"
            value={draft.header.enderecoEntrega}
            onChange={(v) => draft.setField("enderecoEntrega", v)}
          />
          <FormField
            id="venda-data-emissao"
            label="Data de emissão"
            type="date"
            value={draft.header.dataEmissao}
            onChange={(v) => draft.setField("dataEmissao", v)}
          />
          <div />
          <FormField
            id="venda-data-saida"
            label="Data de saída"
            type="date"
            hint="Quando a mercadoria sai do estoque — deixe em branco se for na hora."
            value={draft.header.dataSaida}
            onChange={(v) => draft.setField("dataSaida", v)}
          />
        </div>

        <div className="sale__totals">
          <label className="sale__totals-input-row">
            <span>Frete</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.freight}
              onChange={(e) => draft.setFreight(e.target.value)}
            />
          </label>
          <label className="sale__totals-input-row">
            <span>Desconto</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={draft.discount}
              onChange={(e) => draft.setDiscount(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
