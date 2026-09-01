/**
 * Credenciais da conta de teste, lidas de .env.local (gitignored).
 *
 * Até 28/08/2026 os scripts de verificação traziam e-mail e senha em texto
 * claro e versionados no repositório — quem clonasse o projeto levava junto uma
 * conta real do Supabase de produção. Agora eles leem daqui, e daqui só sai o
 * que estiver no ambiente.
 *
 * Preencha em .env.local:
 *   FACILITE_TEST_EMAIL=...
 *   FACILITE_TEST_PASSWORD=...
 */

import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export function requireTestAccount() {
  const email = process.env.FACILITE_TEST_EMAIL;
  const password = process.env.FACILITE_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Conta de teste não configurada. Defina FACILITE_TEST_EMAIL e " +
        "FACILITE_TEST_PASSWORD em .env.local (ver .env.example).",
    );
  }

  return { email, password };
}
