import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { createContactsRepository } from "../../lib/repositories/contactsRepository";
import { buildFormFields } from "../registry-engine/moduleView";
import RegistryFormModal from "../registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import CnpjLookupField from "./CnpjLookupField";
import { contactInputFromFormValues } from "./contactForm";
import type { Contact, ContactKind } from "./contacts";
import "../../components/ConfirmDialog.css";

type QuickContactFormModalProps = {
  kind: ContactKind;
  /** O que já estava digitado no campo de busca — chega preenchido no nome. */
  initialName?: string;
  onCreated: (contact: Contact) => void;
  onCancel: () => void;
};

/**
 * Cadastro rápido de contato a partir de outra tela (hoje: o campo Cliente
 * de Realizar Venda, quando a busca não encontra ninguém).
 *
 * É o **mesmo** `RegistryFormModal` da tela de Clientes e Fornecedores, com
 * os mesmos campos vindos de `module_fields` — não um formulário paralelo.
 * O que muda é só o destino: em vez de recarregar uma lista, devolve o
 * contato criado para quem chamou selecionar na hora. A foto fica de fora
 * de propósito: quem está no meio de uma venda não para para tirar retrato.
 */
export default function QuickContactFormModal({
  kind,
  initialName,
  onCreated,
  onCancel,
}: QuickContactFormModalProps) {
  const { definition, error: definitionError } = useModuleDefinition("clientes-fornecedores");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const formFields = useMemo(() => (definition ? buildFormFields(definition.fields) : []), [definition]);

  const termo = kind === "clientes" ? "cliente" : "fornecedor";

  const fieldExtras = {
    document: ({
      values,
      setValue,
    }: {
      values: Record<string, string>;
      setValue: (accessorKey: string, value: string) => void;
    }) => <CnpjLookupField values={values} setValue={setValue} />,
  };

  async function handleSubmit(values: Record<string, string>) {
    setSubmitError(null);
    try {
      const repository = createContactsRepository(kind);
      // `code` é gerado pelo repositório; o placeholder abaixo nunca é usado.
      const created = await repository.create({ ...contactInputFromFormValues(values), code: "" });
      onCreated(created);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : `Erro ao cadastrar ${termo}.`);
    }
  }

  if (definitionError) {
    return (
      <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
        <Dialog.Portal>
          <Dialog.Overlay className="confirm-dialog__overlay">
            <Dialog.Content className="confirm-dialog" role="alertdialog" aria-modal="true">
              <Dialog.Title className="confirm-dialog__title" asChild>
                <p>Não foi possível abrir o cadastro</p>
              </Dialog.Title>
              <Dialog.Description className="confirm-dialog__message">{definitionError}</Dialog.Description>
              <div className="confirm-dialog__actions">
                <button
                  className="confirm-dialog__btn confirm-dialog__btn--confirm"
                  type="button"
                  onClick={onCancel}
                >
                  Fechar
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  // Enquanto a definição do módulo não chega não há formulário para mostrar —
  // são três consultas de metadados, resolvidas em instantes.
  if (!definition) return null;

  return (
    <RegistryFormModal
      title={`Novo ${termo}`}
      fields={formFields}
      initialValues={initialName ? { name: initialName } : undefined}
      fieldExtras={fieldExtras}
      submitError={submitError}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
