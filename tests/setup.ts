import { config } from "dotenv";

// As credenciais das contas de teste nunca entram no repositório — vivem em
// .env.local, que é gitignored. Antes de 29/08/2026 os scripts de verificação
// traziam e-mail e senha em texto claro e versionados; ver
// scripts/README.md.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true, override: false });
