import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Fixtures da bateria de isolamento entre filiais (tarefa C1).
 *
 * Duas contas reais, cada uma vinculada a UMA filial, sem nenhuma filial em
 * comum. A bateria autentica como A e tenta ler e escrever dado de B — e o
 * banco tem de recusar sozinho, sem depender de a UI esconder o botão.
 *
 * Cada conta usa um cliente Supabase próprio, com `persistSession: false`:
 * o cliente padrão guarda a sessão num storage compartilhado, e duas contas
 * no mesmo processo acabariam sobrescrevendo o token uma da outra — a bateria
 * inteira passaria autenticada como a última que logou, provando nada.
 */

export type IsolationActor = {
  label: string;
  email: string;
  client: SupabaseClient;
  userId: string;
  branchId: string;
};

/** Toda tabela operacional com `branch_id`. `user_branches` fica de fora: é o
 *  vínculo em si, e tem regra própria (quem gerencia filiais enxerga todos). */
export const BRANCH_SCOPED_TABLES = [
  "products",
  "sales",
  "sale_orders",
  "sale_returns",
  "purchases",
  "conditionals",
  "financial_entries",
  "fiscal_documents",
  "cash_registers",
  "cash_sessions",
  "stock_adjustments",
  "module_records",
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `A bateria de isolamento precisa de ${name} em .env.local.\n` +
        "Ver tests/isolation/README.md para o preparo (duas filiais, duas contas).",
    );
  }
  return value;
}

async function signIn(label: string, emailVar: string, passwordVar: string): Promise<IsolationActor> {
  const url = requireEnv("VITE_SUPABASE_URL");
  const anonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const email = requireEnv(emailVar);

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: requireEnv(passwordVar),
  });
  if (error || !data.user) {
    throw new Error(`Não consegui autenticar ${label} (${email}): ${error?.message ?? "sem usuário"}`);
  }

  const { data: links, error: linksError } = await client
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", data.user.id);
  if (linksError) {
    throw new Error(`Não consegui ler as filiais de ${label}: ${linksError.message}`);
  }
  if (!links || links.length !== 1) {
    throw new Error(
      `${label} (${email}) precisa estar vinculada a exatamente uma filial para a bateria fazer sentido — ` +
        `encontrei ${links?.length ?? 0}.`,
    );
  }

  return { label, email, client, userId: data.user.id, branchId: links[0].branch_id as string };
}

export async function loadActors(): Promise<{ a: IsolationActor; b: IsolationActor }> {
  const a = await signIn("A", "FACILITE_ISOLATION_A_EMAIL", "FACILITE_ISOLATION_A_PASSWORD");
  const b = await signIn("B", "FACILITE_ISOLATION_B_EMAIL", "FACILITE_ISOLATION_B_PASSWORD");

  if (a.branchId === b.branchId) {
    throw new Error(
      "As duas contas de isolamento estão na MESMA filial — a bateria não provaria nada. " +
        "Ver tests/isolation/README.md.",
    );
  }
  return { a, b };
}
