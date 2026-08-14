import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryDetails, RegistryLayout, RegistryTable } from "../../components/registry";
import { uploadContactPhoto } from "../../lib/repositories/contactPhotos";
import { buildDetailFields, buildFormFields, buildTableColumns } from "../registry-engine/moduleView";
import RegistryFormModal from "../registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import { useAuth } from "../auth/AuthContext";
import { ClientsIcon } from "../home/icons";
import type { Contact, ContactKind } from "./contacts";
import { useContactsData } from "./useContactsData";

const MODULE_ID = "clientes-fornecedores";

type ModalState = "none" | "new" | "edit";

/** Módulo "Clientes e Fornecedores" — piloto do motor genérico de metadados. */
export default function CustomersPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  const canEdit = hasPermission(MODULE_ID, "edit");
  const canDelete = hasPermission(MODULE_ID, "delete");

  const { definition, loading: definitionLoading, error: definitionError } =
    useModuleDefinition("clientes-fornecedores");

  const [kind, setKind] = useState<ContactKind>("clientes");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>("none");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const {
    contacts,
    error: contactsError,
    createContact,
    updateContact,
    deleteContact,
  } = useContactsData(kind);

  useEffect(() => {
    openWindow({
      id: "clientes-fornecedores",
      label: "Clientes e Fornecedores",
      path: "/clientes-fornecedores",
      icon: ClientsIcon,
    });
  }, [openWindow]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && contacts.some((contact) => contact.id === current)) return current;
      return contacts[0]?.id ?? null;
    });
  }, [contacts]);

  const visibleContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(term) ||
        contact.document.includes(term) ||
        contact.code.includes(term),
    );
  }, [contacts, search]);

  const selected: Contact | null = visibleContacts.find((contact) => contact.id === selectedId) ?? null;

  const columns = useMemo(
    () => (definition ? buildTableColumns<Contact>(definition.fields) : []),
    [definition],
  );
  const detailFields = useMemo(
    () => (definition ? buildDetailFields<Contact>(definition.fields, selected) : []),
    [definition, selected],
  );
  const formFields = useMemo(() => (definition ? buildFormFields(definition.fields) : []), [definition]);

  async function toggleActive() {
    if (!selected) return;
    await updateContact(selected.id, { active: !selected.active });
  }

  function clearPendingPhoto() {
    setPendingPhotoFile(null);
    setPendingPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function handleNewPhotoSelected(file: File) {
    setPendingPhotoFile(file);
    setPendingPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  async function handleExistingPhotoSelected(contactId: string, file: File) {
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const url = await uploadContactPhoto(contactId, file);
      await updateContact(contactId, { photoUrl: url });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Erro ao enviar foto.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleCreateSubmit(values: Record<string, string>) {
    const created = await createContact({
      name: values.name ?? "",
      document: values.document ?? "",
      active: true,
      address: values.address || undefined,
      rg: values.rg || undefined,
      birthDate: values.birthDate || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      whatsapp: values.whatsapp || undefined,
      inscricaoEstadual: values.inscricaoEstadual || undefined,
      indicadorIe: values.indicadorIe || undefined,
      codigoIbgeMunicipio: values.codigoIbgeMunicipio || undefined,
    });

    if (pendingPhotoFile) {
      try {
        const url = await uploadContactPhoto(created.id, pendingPhotoFile);
        await updateContact(created.id, { photoUrl: url });
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : "Erro ao enviar foto.");
      }
    }

    clearPendingPhoto();
    setModal("none");
  }

  async function handleEditSubmit(values: Record<string, string>) {
    if (!selected) return;
    await updateContact(selected.id, {
      name: values.name || selected.name,
      document: values.document || selected.document,
      address: values.address || undefined,
      rg: values.rg || undefined,
      birthDate: values.birthDate || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      whatsapp: values.whatsapp || undefined,
      inscricaoEstadual: values.inscricaoEstadual || undefined,
      indicadorIe: values.indicadorIe || undefined,
      codigoIbgeMunicipio: values.codigoIbgeMunicipio || undefined,
    });
    setModal("none");
  }

  async function handleConfirmDelete() {
    if (!confirmingDeleteId) return;
    await deleteContact(confirmingDeleteId);
    setConfirmingDeleteId(null);
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  const termo = kind === "clientes" ? "cliente" : "fornecedor";

  if (definitionError || contactsError) {
    return (
      <AppShell navItems={navItems} secondaryText="Clientes e Fornecedores" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{definitionError ?? contactsError}</p>
      </AppShell>
    );
  }

  if (definitionLoading && !definition) {
    return (
      <AppShell navItems={navItems} secondaryText="Clientes e Fornecedores" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Carregando módulo...</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Clientes e Fornecedores" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para acessar este módulo.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Clientes e Fornecedores" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title={`Cadastrar um novo ${termo}`}
          actions={[
            {
              id: "novo",
              label: `Novo ${termo}`,
              disabled: !canCreate,
              onClick: () => setModal("new"),
            },
            {
              id: "editar",
              label: "Editar",
              disabled: !selected || !canEdit,
              onClick: () => setModal("edit"),
            },
            {
              id: "excluir",
              label: "Excluir",
              disabled: !selected || !canDelete,
              onClick: () => selected && setConfirmingDeleteId(selected.id),
            },
          ]}
        />

        <RegistryTable
          tabs={definition?.tabs.map((tab) => ({ id: tab.id, label: tab.label })) ?? []}
          activeTab={kind}
          onTabChange={(id) => {
            setKind(id as ContactKind);
            setSelectedId(null);
          }}
          columns={columns}
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
            disabled: !selected || !canEdit,
            onToggle: toggleActive,
          }}
          fields={detailFields}
          media={{
            label: "Foto",
            hint: "Ou arraste para cá",
            layout: "stacked",
            imageUrl: selected?.photoUrl ?? null,
            uploading: photoUploading,
            disabled: !selected || !canEdit,
            onFileSelected: (file) => selected && handleExistingPhotoSelected(selected.id, file),
          }}
        />
      </RegistryLayout>

      {photoError && (
        <p style={{ color: "var(--amber)", padding: "0 24px" }}>{photoError}</p>
      )}

      {modal === "new" && (
        <RegistryFormModal
          title={`Novo ${termo}`}
          fields={formFields}
          mediaField={{
            label: "Foto",
            imageUrl: pendingPhotoPreview,
            onFileSelected: handleNewPhotoSelected,
          }}
          onSubmit={handleCreateSubmit}
          onCancel={() => {
            clearPendingPhoto();
            setModal("none");
          }}
        />
      )}

      {modal === "edit" && selected && (
        <RegistryFormModal
          title={`Editar ${termo}`}
          fields={formFields}
          mediaField={{
            label: "Foto",
            imageUrl: selected.photoUrl ?? null,
            uploading: photoUploading,
            onFileSelected: (file) => handleExistingPhotoSelected(selected.id, file),
          }}
          initialValues={{
            name: selected.name,
            document: selected.document,
            address: selected.address ?? "",
            rg: selected.rg ?? "",
            birthDate: selected.birthDate ?? "",
            phone: selected.phone ?? "",
            email: selected.email ?? "",
            whatsapp: selected.whatsapp ?? "",
            inscricaoEstadual: selected.inscricaoEstadual ?? "",
            indicadorIe: selected.indicadorIe ?? "",
            codigoIbgeMunicipio: selected.codigoIbgeMunicipio ?? "",
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {confirmingDeleteId && (
        <ConfirmDialog
          title={`Excluir ${termo}?`}
          message="Essa ação não pode ser desfeita."
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDeleteId(null)}
        />
      )}
    </AppShell>
  );
}
