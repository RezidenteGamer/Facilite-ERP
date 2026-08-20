import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useModuleCatalog } from "../modules/ModuleCatalogContext";
import { extractErrorMessage } from "../modules/useGenericModuleData";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import {
  addModuleField,
  createUserModule,
  deleteUserModule,
  fetchBuilderModules,
  fetchModuleFields,
  removeModuleField,
  updateModuleField,
  type BuilderModule,
  type NewModuleField,
  type NewModuleInput,
} from "./moduleBuilder";

/**
 * Estado do construtor de módulos: a lista do catálogo cru e os campos do
 * módulo selecionado.
 *
 * Depois de criar ou excluir um módulo o catálogo do app inteiro muda (rota,
 * tile da tela inicial, dock), e a permissão do criador acabou de nascer no
 * banco. Por isso as duas ações recarregam **também** o catálogo compartilhado
 * e as permissões da sessão — senão o módulo recém-criado só apareceria depois
 * de um F5, e o tile ficaria escondido por uma permissão que já existe no
 * banco mas não no cache do cliente.
 */
export function useModuleBuilderData() {
  const { reload: reloadCatalog } = useModuleCatalog();
  const { refreshPermissions } = useAuth();

  const [modules, setModules] = useState<BuilderModule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fields, setFields] = useState<ModuleFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadModules = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchBuilderModules();
      setModules(rows);
      setError(null);
      return rows;
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os módulos."));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadFields = useCallback(async (moduleId: string | null) => {
    if (!moduleId) {
      setFields([]);
      return;
    }
    try {
      setFields(await fetchModuleFields(moduleId));
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os campos do módulo."));
    }
  }, []);

  useEffect(() => {
    reloadModules();
  }, [reloadModules]);

  useEffect(() => {
    reloadFields(selectedId);
  }, [selectedId, reloadFields]);

  const selected = modules.find((module) => module.id === selectedId) ?? null;

  const createModule = useCallback(
    async (input: NewModuleInput) => {
      const id = await createUserModule(input);
      await Promise.all([reloadModules(), reloadCatalog(), refreshPermissions()]);
      setSelectedId(id);
      return id;
    },
    [reloadModules, reloadCatalog, refreshPermissions],
  );

  const deleteModule = useCallback(
    async (moduleId: string) => {
      await deleteUserModule(moduleId);
      setSelectedId(null);
      await Promise.all([reloadModules(), reloadCatalog(), refreshPermissions()]);
    },
    [reloadModules, reloadCatalog, refreshPermissions],
  );

  const addField = useCallback(
    async (moduleId: string, field: NewModuleField) => {
      await addModuleField(moduleId, field);
      await reloadFields(moduleId);
    },
    [reloadFields],
  );

  const editField = useCallback(
    async (fieldId: string, patch: NewModuleField) => {
      await updateModuleField(fieldId, patch);
      await reloadFields(selectedId);
    },
    [reloadFields, selectedId],
  );

  const dropField = useCallback(
    async (fieldId: string) => {
      await removeModuleField(fieldId);
      await reloadFields(selectedId);
    },
    [reloadFields, selectedId],
  );

  return {
    modules,
    selected,
    selectedId,
    setSelectedId,
    fields,
    loading,
    error,
    setError,
    createModule,
    deleteModule,
    addField,
    editField,
    dropField,
  };
}
