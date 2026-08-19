/**
 * Busca de grupos tributários para o `LookupModal` — alimenta o campo "Grupo
 * tributário" do formulário de Produtos.
 *
 * Mesmo papel de `contactLookups.ts` (que alimenta o lookup de contato em
 * Realizar Venda/Pedidos/Financeiro): o cadastro do grupo em si roda pela
 * `GenericModulePage` em `/grupos-tributarios`; isto aqui é só a consulta de
 * quem precisa escolher um.
 */
import { supabase } from "../supabaseClient";
import type { TaxGroup } from "../fiscal/taxGroups";

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export function toTaxGroup(row: {
  id: string;
  code: string;
  name: string;
  cst_icms: string | null;
  csosn: string | null;
  aliquota_icms: number | null;
  cst_pis: string | null;
  aliquota_pis: number | null;
  cst_cofins: string | null;
  aliquota_cofins: number | null;
  cst_ibs_cbs: string | null;
  cclasstrib: string | null;
}): TaxGroup {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cstIcms: row.cst_icms,
    csosn: row.csosn,
    aliquotaIcms: row.aliquota_icms,
    cstPis: row.cst_pis,
    aliquotaPis: row.aliquota_pis,
    cstCofins: row.cst_cofins,
    aliquotaCofins: row.aliquota_cofins,
    cstIbsCbs: row.cst_ibs_cbs,
    cclasstrib: row.cclasstrib,
  };
}

/** Busca grupos por código ou nome. Sem termo, devolve os primeiros 20 por código. */
export async function fetchTaxGroups(query: string): Promise<TaxGroup[]> {
  const client = assertSupabase();
  let request = client.from("tax_groups").select("*").order("code");
  const term = query.trim();
  if (term) {
    request = request.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
  }
  const { data, error } = await request.limit(20);
  if (error) throw error;
  return (data ?? []).map(toTaxGroup);
}
