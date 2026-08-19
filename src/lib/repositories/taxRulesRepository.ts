/** Leitura de `tax_rules` para quem precisa chamar `resolveTaxRule` (Notas Emitidas hoje; NFC-e na etapa 8.5). */
import { supabase } from "../supabaseClient";
import type { TaxRuleRow } from "../fiscal/taxRules";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export async function fetchTaxRules(): Promise<TaxRuleRow[]> {
  const client = assertSupabase();
  const { data, error } = await client.from("tax_rules").select("*");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    regime: row.regime,
    naturezaOperacao: row.natureza_operacao,
    ufOrigem: row.uf_origem,
    ufDestino: row.uf_destino,
    tipoCliente: row.tipo_cliente,
    cfop: row.cfop,
  }));
}
