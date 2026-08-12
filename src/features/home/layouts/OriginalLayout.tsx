import { useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../../components/AppShell";
import ConfirmDialog from "../../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../../components/icons";
import IconsLayoutMenu from "../components/IconsLayoutMenu";
import ModuleGrid from "../components/ModuleGrid";
import { useIconsArrangement } from "../useIconsArrangement";
import "./OriginalLayout.css";

const MENU_WIDTH = 200;
const MENU_HEIGHT = 130;

/**
 * Layout "Original" da tela inicial — réplica do design de referência.
 * A moldura (cabeçalho azul + abas flutuantes) vem de AppShell, compartilhada
 * com as demais telas; aqui só entram os módulos e o que é específico da home.
 */
export default function OriginalLayout() {
  const navigate = useNavigate();
  const { arrangement, setArrangement } = useIconsArrangement();
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  function handleContentContextMenu(event: MouseEvent) {
    event.preventDefault();
    setMenuPosition({
      x: Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - 8),
    });
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, active: true },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell
      navItems={navItems}
      secondaryText="Filial 1 - (nome empresa)"
      moduleLabel="Comércio"
      reserveHeaderScroll
      onContentContextMenu={handleContentContextMenu}
      onBack={() => setLogoutConfirmOpen(true)}
    >
      <ModuleGrid arrangement={arrangement} />

      {menuPosition && (
        <IconsLayoutMenu
          position={menuPosition}
          current={arrangement}
          onSelect={setArrangement}
          onClose={() => setMenuPosition(null)}
        />
      )}

      {logoutConfirmOpen && (
        <ConfirmDialog
          title="Deseja realmente sair?"
          confirmLabel="Sair"
          cancelLabel="Cancelar"
          onConfirm={() => navigate("/")}
          onCancel={() => setLogoutConfirmOpen(false)}
        />
      )}
    </AppShell>
  );
}
