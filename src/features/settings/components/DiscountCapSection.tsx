import { useAuth } from "../../auth/AuthContext";
import SettingsLinkSection from "./SettingsLinkSection";

/**
 * Atalho, **não** um segundo cadastro (D1, 09/09/2026).
 *
 * O plano lista "teto de desconto por perfil" entre as configurações — e ele
 * já existe: C3 pôs `roles.max_discount_percent` editável na grade de
 * `/permissoes`, ao lado das outras capacidades do papel, que é onde ele
 * pertence (é atributo do papel, não da filial nem do sistema). Reconstruí-lo
 * aqui criaria duas telas gravando a mesma coluna, e a primeira divergência
 * entre elas seria um desconto aprovado numa e recusado na outra.
 *
 * O que sobra para Configurações é o problema real que a duplicação tentaria
 * resolver: quem procura o teto de desconto procura aqui. Então aqui tem a
 * placa dizendo onde ele está.
 */
export default function DiscountCapSection() {
  const { profile } = useAuth();

  return (
    <SettingsLinkSection
      title="Vendas"
      label="Teto de desconto por perfil"
      hint={
        'Cadastrado em Permissões, na coluna "Desconto máximo" de cada papel de acesso — é atributo ' +
        "do papel, não da filial. Vale sobre o valor bruto, somando desconto por item e desconto de cabeçalho."
      }
      to="/permissoes"
      allowed={Boolean(profile?.canManagePermissions)}
      deniedMessage="Você não tem permissão para gerenciar permissões."
    />
  );
}
