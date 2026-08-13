import { useCallback, useEffect, useState } from "react";
import { createContactsRepository } from "../../lib/repositories/contactsRepository";
import type { Contact, ContactKind } from "./contacts";

export type NewContactInput = Omit<Contact, "id" | "code" | "createdAt">;

/** Carrega e muta os contatos de um `kind` via Supabase, com estado de loading/erro. */
export function useContactsData(kind: ContactKind) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const repository = createContactsRepository(kind);
      const rows = await repository.list({});
      setContacts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar contatos.");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createContact(input: NewContactInput) {
    const repository = createContactsRepository(kind);
    // `code` é gerado pelo repositório; o placeholder abaixo nunca é usado.
    await repository.create({ ...input, code: "" });
    await reload();
  }

  async function updateContact(id: string, patch: Partial<Contact>) {
    const repository = createContactsRepository(kind);
    await repository.update(id, patch);
    await reload();
  }

  async function deleteContact(id: string) {
    const repository = createContactsRepository(kind);
    await repository.remove(id);
    await reload();
  }

  return { contacts, loading, error, reload, createContact, updateContact, deleteContact };
}
