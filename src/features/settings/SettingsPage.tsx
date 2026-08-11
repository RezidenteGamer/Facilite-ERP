import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import SettingsPanel from "./components/SettingsPanel";

/** Tela de Configurações — usa a mesma moldura (AppShell) da home, só o conteúdo muda. */
export default function SettingsPage() {
  const navigate = useNavigate();

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, active: true },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Configurações">
      <SettingsPanel />
    </AppShell>
  );
}
