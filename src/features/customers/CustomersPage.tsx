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
import { ClientsIcon } from "../home/icons";
import { CONTACTS, type Contact, type ContactKind } from "./contacts";

const COLUNAS: RegistryColumn<Contact>[] = [
  { key: "code", label: "Código", width: "110px", align: "center", render: (c) => c.code },
  { key: "name", label: "Nome", width: "minmax(0, 1fr)", render: (c) => c.name },
  { key: "document", label: "CPF/CNPJ", width: "190px", render: (c) => c.document },
];

/** Módulo "Clientes e Fornecedores". */
export default function CustomersPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [kind, setKind] = useState<ContactKind>("clientes");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState(CONTACTS);
  const [selectedId, setSelectedId] = useState<string | null>(CONTACTS.clientes[0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "clientes-fornecedores",
      label: "Clientes e Fornecedores",
      path: "/clientes-fornecedores",
      icon: ClientsIcon,
    });
  }, [openWindow]);

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = contacts[kind];
    if (!term) return list;
    return list.filter(
      (contact) =>
        contact.name.toLowerCase().includes(term) ||
        contact.document.includes(term) ||
        contact.code.includes(term),
    );
  }, [contacts, kind, search]);

  const selected: Contact | null =
    visibleContacts.find((contact) => contact.id === selectedId) ?? null;

  function toggleActive() {
    if (!selected) return;
    setContacts((current) => ({
      ...current,
      [kind]: current[kind].map((contact) =>
        contact.id === selected.id ? { ...contact, active: !contact.active } : contact,
      ),
    }));
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  const termo = kind === "clientes" ? "cliente" : "fornecedor";

  return (
    <AppShell
      navItems={navItems}
      secondaryText="Clientes e Fornecedores"
      contentTone="blue"
      fillViewport
    >
      <RegistryLayout>
        <RegistryActions
          title={`Cadastrar um novo ${termo}`}
          actions={[
            { id: "novo", label: `Novo ${termo}` },
            { id: "editar", label: "Editar", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />

        <RegistryTable
          tabs={[
            { id: "clientes", label: "Clientes" },
            { id: "fornecedores", label: "Fornecedores" },
          ]}
          activeTab={kind}
          onTabChange={(id) => {
            const next = id as ContactKind;
            setKind(next);
            setSelectedId(contacts[next][0]?.id ?? null);
          }}
          columns={COLUNAS}
          rows={visibleContacts}
          getRowId={(contact) => contact.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel={kind === "clientes" ? "Buscar cliente" : "Buscar fornecedor"}
          search={search}
          onSearchChange={setSearch}
          status={{
            active: Boolean(selected?.active),
            disabled: !selected,
            onToggle: toggleActive,
          }}
          fields={[
            { label: "Endereço", value: selected?.address },
            { label: "Rg", value: selected?.rg },
            { label: "Data aniversario", value: selected?.birthDate },
            { label: "Telefone", value: selected?.phone },
            { label: "Email", value: selected?.email },
            { label: "Whatsapp", value: selected?.whatsapp },
            { label: "Data de cadastro", value: selected?.createdAt },
          ]}
          media={{ label: "Foto", hint: "Ou arraste para cá", layout: "stacked" }}
        />
      </RegistryLayout>
    </AppShell>
  );
}
