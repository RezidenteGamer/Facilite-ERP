import { useState } from "react";
import SearchCombobox from "../../../components/form/SearchCombobox";
import { useAuth } from "../../auth/AuthContext";
import type { Contact } from "../../customers/contacts";
import QuickContactFormModal from "../../customers/QuickContactFormModal";
import { fetchSaleContacts, fetchSaleSellers, type SaleSeller } from "../../../lib/repositories/salesLookups";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

type ClienteStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
};

/** Etapa 1: quem comprou e quem vendeu — o vendedor já chega preenchido (ver useSaleDraft). */
export default function ClienteStep({ draft }: ClienteStepProps) {
  const { hasPermission } = useAuth();
  const canCreateContact = hasPermission("clientes-fornecedores", "create");

  /** Nome digitado que originou o "Cadastrar novo" — `null` = modal fechado. */
  const [creatingContactName, setCreatingContactName] = useState<string | null>(null);

  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Quem é o cliente?</p>
        <div className="sale__who">
          <SearchCombobox<Contact>
            id="venda-cliente"
            label="Cliente"
            placeholder="Digite o nome ou o documento..."
            value={draft.header.clienteNome}
            onChange={(value) => {
              draft.setField("clienteNome", value);
              /* Digitar por cima de um cliente já escolhido desfaz a escolha:
                 senão a venda gravaria o id antigo enquanto a tela mostra um
                 nome novo — e o campo agora é, antes de tudo, para digitar. */
              if (draft.header.clienteId) draft.setField("clienteId", "");
            }}
            fetchItems={fetchSaleContacts}
            getKey={(contact) => contact.id}
            renderItem={(contact) => ({ primary: contact.name, secondary: contact.document })}
            onSelect={(contact) => draft.selectContact(contact)}
            /* Sem permissão de criar contato o atalho some — oferecer um
               cadastro que o banco vai recusar só produz erro. */
            onCreateNew={canCreateContact ? (query) => setCreatingContactName(query) : undefined}
            createNewLabel="Cadastrar novo cliente"
          />

          {/* Vendedor é um usuário do sistema (`profiles`), gerido em
              /usuarios-operadores — não um cadastro de negócio que faça
              sentido criar daqui. Por isso, sem `onCreateNew`. */}
          <SearchCombobox<SaleSeller>
            id="venda-vendedor"
            label="Vendedor"
            placeholder="Digite o nome..."
            value={draft.header.vendedorNome}
            onChange={(value) => {
              draft.setField("vendedorNome", value);
              if (draft.header.vendedorId) draft.setField("vendedorId", "");
            }}
            fetchItems={fetchSaleSellers}
            getKey={(seller) => seller.id}
            renderItem={(seller) => ({ primary: seller.name, secondary: seller.operatorCode })}
            onSelect={(seller) => draft.selectSeller(seller)}
          />
        </div>
      </div>

      {/* Aninhado aqui, no mesmo ponto da árvore em que o campo vive — é
          assim que o Radix empilha um diálogo sobre o que estiver embaixo
          sem que o de baixo interprete o clique como "clicou fora". */}
      {creatingContactName !== null && (
        <QuickContactFormModal
          kind="clientes"
          initialName={creatingContactName}
          onCancel={() => setCreatingContactName(null)}
          onCreated={(contact) => {
            draft.selectContact(contact);
            setCreatingContactName(null);
          }}
        />
      )}
    </div>
  );
}
