import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { UsersIcon } from "../home/icons";
import { SYSTEM_USERS, type SystemUser } from "./users";

const COLUNAS: RegistryColumn<SystemUser>[] = [
  { key: "code", label: "Código", width: "80px", align: "center", render: (u) => u.code },
  { key: "name", label: "Nome", width: "minmax(0, 1fr)", render: (u) => u.name },
  { key: "document", label: "CPF/CNPJ", width: "150px", render: (u) => u.document },
  { key: "operatorCode", label: "Operador", width: "100px", align: "center", render: (u) => u.operatorCode },
];

/** Módulo "Usuarios e Operadores". */
export default function UsersPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState(SYSTEM_USERS);
  const [selectedId, setSelectedId] = useState<string | null>(SYSTEM_USERS[0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "usuarios-operadores",
      label: "Usuarios e Operadores",
      path: "/usuarios-operadores",
      icon: UsersIcon,
    });
  }, [openWindow]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) => user.name.toLowerCase().includes(term) || user.document.includes(term),
    );
  }, [users, search]);

  const selected: SystemUser | null = visibleUsers.find((u) => u.id === selectedId) ?? null;

  function toggleActive() {
    if (!selected) return;
    setUsers((current) =>
      current.map((user) => (user.id === selected.id ? { ...user, active: !user.active } : user)),
    );
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Usuarios e Operadores" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title="Cadastrar um novo cliente"
          actions={[
            { id: "novo", label: "Novo usuario" },
            { id: "editar", label: "Editar", disabled: !selected },
            { id: "permissoes", label: "Permissões", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />

        <RegistryTable
          columns={COLUNAS}
          rows={visibleUsers}
          getRowId={(user) => user.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar Usuario"
          search={search}
          onSearchChange={setSearch}
          status={{
            active: Boolean(selected?.active),
            disabled: !selected,
            onToggle: toggleActive,
          }}
          fields={[
            { label: "Email", value: selected?.email },
            { label: "Data de cadastro", value: selected?.createdAt },
          ]}
          media={{ label: "Foto", layout: "stacked" }}
        />
      </RegistryLayout>
    </AppShell>
  );
}
