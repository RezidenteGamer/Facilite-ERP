import { useAuth } from "../../auth/AuthContext";
import SettingsLinkSection from "./SettingsLinkSection";

/**
 * Porta de entrada do cadastro de filiais (D1, 09/09/2026).
 *
 * As duas seções que já moravam neste painel — `StockPolicySection` (20/08) e
 * `SimplesCreditSection` (B8, 03/09) — editam **um parâmetro da filial ativa**
 * cada, e as duas registram no comentário o mesmo motivo de estarem aqui: não
 * existia módulo de Filiais. Agora existe uma tela, e as duas continuam onde
 * estão de propósito — parâmetro do dia a dia da filial em que se está
 * trabalhando é outra coisa de cadastro de filial, e quem mexe num não é
 * necessariamente quem mexe no outro.
 *
 * Gated por `can_manage_branches`, a mesma flag que a RLS de `branches` exige.
 */
export default function BranchesSection() {
  const { profile } = useAuth();

  return (
    <SettingsLinkSection
      title="Filiais"
      label="Cadastro de filiais"
      hint="Código, nome, CNPJ, dados fiscais e endereço — o que a emissão de nota lê para montar o emitente. Vincular usuários a filiais ainda é feito por SQL."
      to="/configuracoes/filiais"
      allowed={Boolean(profile?.canManageBranches)}
      deniedMessage="Você não tem permissão para gerenciar filiais."
    />
  );
}
