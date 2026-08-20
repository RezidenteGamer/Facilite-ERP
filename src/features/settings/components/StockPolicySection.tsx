import { useEffect, useState } from "react";
import { fetchBranchAllowsNegativeStock, updateBranchAllowsNegativeStock } from "../../../lib/repositories/branchesRepository";
import { useAuth } from "../../auth/AuthContext";

/**
 * Primeiro parâmetro real de Configurações (as demais ações do painel ainda
 * são decorativas) — escopado pela filial ativa, não uma tela de
 * administração de Filiais própria (essa continua só por SQL). Gated por
 * `can_manage_branches`, a mesma flag que já protege `branches update` no
 * RLS: sem ela o toggle aparece desabilitado, não escondido, para deixar
 * claro que o parâmetro existe mesmo sem permissão de mudá-lo.
 */
export default function StockPolicySection() {
  const { currentBranchId, profile } = useAuth();
  const canManage = Boolean(profile?.canManageBranches);

  const [allow, setAllow] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentBranchId) {
      setAllow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchBranchAllowsNegativeStock(currentBranchId)
      .then((value) => {
        if (!cancelled) setAllow(value);
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

  async function handleToggle() {
    if (!currentBranchId || allow === null || saving || !canManage) return;
    const next = !allow;
    setSaving(true);
    setError(null);
    try {
      await updateBranchAllowsNegativeStock(currentBranchId, next);
      setAllow(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  if (!currentBranchId) return null;

  return (
    <div className="settings-panel__section">
      <p className="settings-panel__section-title">Estoque</p>

      <div className="settings-panel__row">
        <div className="settings-panel__row-text">
          <span className="settings-panel__row-label">Permitir estoque negativo nesta filial</span>
          <span className="settings-panel__row-hint">
            Vale como padrão para todos os produtos da filial ativa — um produto específico pode
            sobrescrever esta configuração no próprio cadastro.
          </span>
        </div>

        <button
          className={`settings-panel__switch${allow ? " settings-panel__switch--on" : ""}`}
          type="button"
          role="switch"
          aria-checked={Boolean(allow)}
          aria-label="Permitir estoque negativo nesta filial"
          disabled={loading || saving || allow === null || !canManage}
          onClick={handleToggle}
        >
          <span className="settings-panel__switch-knob" />
        </button>
      </div>

      {!canManage && (
        <p className="settings-panel__row-hint">
          Você não tem permissão para alterar esta configuração.
        </p>
      )}
      {error && <p className="settings-panel__error">{error}</p>}
    </div>
  );
}
