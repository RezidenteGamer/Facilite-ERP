import { useState } from "react";
import FormField from "../../../components/form/FormField";
import LookupModal from "../../../components/form/LookupModal";
import type { Contact } from "../../customers/contacts";
import { fetchSaleContacts, fetchSaleSellers, type SaleSeller } from "../../../lib/repositories/salesLookups";
import type { useSaleDraft } from "../useSaleDraft";
import "../SalePage.css";

type LookupKind = "cliente" | "vendedor" | null;

type ClienteStepProps = {
  draft: ReturnType<typeof useSaleDraft>;
};

/** Etapa 1: quem comprou e quem vendeu — o vendedor já chega preenchido (ver useSaleDraft). */
export default function ClienteStep({ draft }: ClienteStepProps) {
  const [lookup, setLookup] = useState<LookupKind>(null);

  return (
    <div className="sale__panel">
      <div className="sale__card">
        <p className="sale__cart-title">Quem é o cliente?</p>
        <div className="sale__who">
          <FormField
            id="venda-cliente"
            label="Cliente"
            value={draft.header.clienteNome}
            onChange={(v) => draft.setField("clienteNome", v)}
            lookup
            onLookup={() => setLookup("cliente")}
          />
          <FormField
            id="venda-vendedor"
            label="Vendedor"
            value={draft.header.vendedorNome}
            onChange={(v) => draft.setField("vendedorNome", v)}
            lookup
            onLookup={() => setLookup("vendedor")}
          />
        </div>
      </div>

      {lookup === "cliente" && (
        <LookupModal<Contact>
          title="Selecionar cliente"
          placeholder="Buscar por nome ou documento..."
          onClose={() => setLookup(null)}
          fetchItems={fetchSaleContacts}
          getKey={(c) => c.id}
          renderItem={(c) => ({ primary: c.name, secondary: c.document })}
          onSelect={(c) => {
            draft.selectContact(c);
            setLookup(null);
          }}
        />
      )}

      {lookup === "vendedor" && (
        <LookupModal<SaleSeller>
          title="Selecionar vendedor"
          placeholder="Buscar por nome..."
          onClose={() => setLookup(null)}
          fetchItems={fetchSaleSellers}
          getKey={(s) => s.id}
          renderItem={(s) => ({ primary: s.name, secondary: s.operatorCode })}
          onSelect={(s) => {
            draft.selectSeller(s);
            setLookup(null);
          }}
        />
      )}
    </div>
  );
}
