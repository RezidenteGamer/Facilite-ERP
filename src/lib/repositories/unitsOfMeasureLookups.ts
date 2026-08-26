/**
 * Busca de unidades de medida (`units_of_measure`) para quem precisa da
 * lista inteira de uma vez — o `<select>` de "Unidade comercial"/"Unidade
 * tributável" em Produtos, e a checagem de fração nas telas que digitam
 * quantidade (Realizar Venda, Compras, Pedidos de venda, Ajuste de estoque).
 *
 * O cadastro em si roda pela `GenericModulePage` em `/unidades-medida`; isto
 * aqui é só a leitura de quem consome. Lista curta (dezena de linhas), então
 * busca tudo de uma vez — sem paginação, sem termo de busca, diferente de
 * `fetchTaxGroups`.
 */
import { supabase } from "../supabaseClient";

export type UnitOfMeasure = {
  id: string;
  code: string;
  label: string;
  allowsFraction: boolean;
};

function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase não está configurado. Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em .env.local.",
    );
  }
  return supabase;
}

export async function fetchUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from("units_of_measure")
    .select("id, code, label, allows_fraction")
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    allowsFraction: row.allows_fraction,
  }));
}

/**
 * Se a unidade do produto (`unidadeComercial`) permite quantidade fracionada.
 * Produto sem unidade definida, ou unidade que não bate com nenhuma linha do
 * cadastro, continua fracionável — ausência de informação nunca vira trava.
 */
export function unitAllowsFraction(unidadeComercial: string | undefined, units: UnitOfMeasure[]): boolean {
  if (!unidadeComercial) return true;
  const unit = units.find((u) => u.code === unidadeComercial);
  return unit ? unit.allowsFraction : true;
}
