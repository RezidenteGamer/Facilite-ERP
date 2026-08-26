import { useState } from "react";
import { parseAmount } from "../../lib/amount";
import "./MarginCalculator.css";

type MarginMode = "percent" | "fixed";

type MarginCalculatorProps = {
  costPrice: string;
  onApply: (salePrice: string) => void;
};

/**
 * Atalho de preenchimento do "Preço venda" a partir do "Preço custo" — não é
 * um vínculo entre os dois campos. Aplica uma vez e escreve o resultado; se o
 * custo mudar depois, o preço de venda já preenchido NÃO recalcula sozinho
 * (isso seria um vínculo permanente, um comportamento bem mais complexo e não
 * o que foi pedido — ver AGENTS.md/prompt desta etapa).
 *
 * Fica em `fieldExtras.costPrice` do `RegistryFormModal` (ver ali por quê),
 * não vira capacidade nova do motor genérico: é específica de Produtos.
 */
export default function MarginCalculator({ costPrice, onApply }: MarginCalculatorProps) {
  const [mode, setMode] = useState<MarginMode>("percent");
  const [margin, setMargin] = useState("");

  const cost = parseAmount(costPrice);
  const marginValue = parseAmount(margin);
  const canCalculate = cost !== null && cost > 0 && marginValue !== null;

  const result = canCalculate
    ? mode === "percent"
      ? cost * (1 + marginValue / 100)
      : cost + marginValue
    : null;

  function handleApply() {
    if (result === null) return;
    onApply(result.toFixed(2));
  }

  return (
    <div className="margin-calculator">
      <div className="margin-calculator__mode">
        <button
          type="button"
          className={`margin-calculator__mode-btn${mode === "percent" ? " margin-calculator__mode-btn--active" : ""}`}
          onClick={() => setMode("percent")}
        >
          %
        </button>
        <button
          type="button"
          className={`margin-calculator__mode-btn${mode === "fixed" ? " margin-calculator__mode-btn--active" : ""}`}
          onClick={() => setMode("fixed")}
        >
          R$ fixo
        </button>
      </div>

      <input
        className="margin-calculator__input"
        type="text"
        inputMode="decimal"
        placeholder={mode === "percent" ? "Margem, ex.: 50" : "Lucro, ex.: 10,00"}
        value={margin}
        onChange={(event) => setMargin(event.target.value)}
        disabled={cost === null || cost <= 0}
      />

      <button
        type="button"
        className="margin-calculator__apply"
        disabled={result === null}
        onClick={handleApply}
      >
        Aplicar em "Preço venda"
      </button>

      {cost === null || cost <= 0 ? (
        <p className="margin-calculator__hint">Preencha o preço de custo para calcular.</p>
      ) : result !== null ? (
        <p className="margin-calculator__hint">
          Preço de venda calculado: R$ {result.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      ) : null}
    </div>
  );
}
