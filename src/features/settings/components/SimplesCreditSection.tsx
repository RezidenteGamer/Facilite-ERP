import { useEffect, useState } from "react";
import {
  fetchBranchSimplesCreditRate,
  updateBranchSimplesCreditRate,
} from "../../../lib/repositories/branchesRepository";
import { parseAmount } from "../../../lib/amount";
import { useAuth } from "../../auth/AuthContext";

/**
 * O `pCredSN` da filial ativa — a alíquota de crédito de ICMS do Simples
 * Nacional (B8, 03/09/2026).
 *
 * Mora em Configurações, e não num módulo de Filiais, porque **não existe**
 * módulo de Filiais: `branches` é cadastro só por SQL, com RLS própria, e a
 * única tela que a toca é o seletor de filial (que só lê). O desenho aqui é
 * literalmente o de `StockPolicySection` — parâmetro por filial ativa, gated
 * por `can_manage_branches` (a mesma flag do RLS de `branches update`),
 * desabilitado em vez de escondido quando falta permissão.
 *
 * Sem este campo a coluna de B8 só seria preenchível por SQL, e ela é um
 * número que muda a cada virada de faixa de RBT12 — mensal, na prática. É o
 * mesmo argumento que fez B1 e B5 criarem linhas em `module_fields`: coluna sem
 * campo é coluna que ninguém consegue cadastrar pela aplicação.
 */
export default function SimplesCreditSection() {
  const { currentBranchId, profile } = useAuth();
  const canManage = Boolean(profile?.canManageBranches);

  /** Texto do input, não número: o campo aceita vírgula decimal e pode ficar vazio. */
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!currentBranchId) {
      setRate("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSaved(false);
    fetchBranchSimplesCreditRate(currentBranchId)
      .then((value) => {
        if (!cancelled) setRate(value === null ? "" : String(value).replace(".", ","));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar a configuração.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentBranchId]);

  async function handleSave() {
    if (!currentBranchId || saving || !canManage) return;

    // Vazio é intenção legítima ("esta filial não transfere crédito"), e limpa
    // a coluna. Qualquer outra coisa tem de ser um percentual válido: gravar
    // zero por causa de um "abc" digitado é o bug que `parseAmount` existe para
    // não repetir (correção de 17/08/2026).
    const trimmed = rate.trim();
    let value: number | null = null;
    if (trimmed) {
      const parsed = parseAmount(trimmed);
      if (parsed === null) {
        setError("A alíquota de crédito precisa ser um número válido (use vírgula ou ponto).");
        return;
      }
      if (parsed < 0 || parsed > 100) {
        setError("A alíquota de crédito precisa estar entre 0 e 100.");
        return;
      }
      value = parsed;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateBranchSimplesCreditRate(currentBranchId, value);
      // Relê em vez de exibir o que foi digitado: a coluna é `numeric(7,4)` e
      // arredonda silenciosamente (1,23456 gravado vira 1,2346). Mostrar o
      // texto local deixaria o campo afirmando um valor que o banco não tem —
      // e o número aqui vira imposto na nota de alguém.
      const gravado = await fetchBranchSimplesCreditRate(currentBranchId);
      setRate(gravado === null ? "" : String(gravado).replace(".", ","));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  if (!currentBranchId) return null;

  return (
    <div className="settings-panel__section">
      <p className="settings-panel__section-title">Fiscal — Simples Nacional</p>

      <div className="settings-panel__row">
        <div className="settings-panel__row-text">
          <label className="settings-panel__row-label" htmlFor="settings-credito-simples">
            Alíquota de crédito de ICMS (%)
          </label>
          <span className="settings-panel__row-hint">
            O <code>pCredSN</code> desta filial: o percentual de ICMS dentro da alíquota do Simples
            Nacional, pela faixa de receita dos últimos 12 meses do mês anterior. Vai nas notas com
            CSOSN 101 ou 201, que sem ele não podem ser emitidos. Deixe vazio se esta filial não
            transfere crédito (CSOSN 102 ou 202) ou não é do Simples.
          </span>
        </div>

        <div className="settings-panel__field">
          <input
            id="settings-credito-simples"
            className="settings-panel__input"
            type="text"
            inputMode="decimal"
            placeholder="0,0000"
            value={rate}
            disabled={loading || saving || !canManage}
            onChange={(event) => {
              setRate(event.target.value);
              setSaved(false);
            }}
          />
          <button
            className="settings-panel__btn"
            type="button"
            disabled={loading || saving || !canManage}
            onClick={handleSave}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      {!canManage && (
        <p className="settings-panel__row-hint">Você não tem permissão para alterar esta configuração.</p>
      )}
      {saved && <p className="settings-panel__row-hint">Alíquota de crédito salva.</p>}
      {error && <p className="settings-panel__error">{error}</p>}
    </div>
  );
}
