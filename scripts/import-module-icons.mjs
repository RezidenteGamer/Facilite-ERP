// Script único: converte os ícones de
// "Recursos de Desenvolvimento/Icones" (pasta fora do repo, ver .gitignore)
// em WebP leve + placeholder borrado, prontos pra usar com FadeImage. Rode de
// novo (atualizando o MAP abaixo) sempre que novos ícones aparecerem na
// pasta. Precisa de `npm i -D sharp` (não fica como dependência do projeto).
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";

const SRC_DIR = "Recursos de Desenvolvimento/Icones";
const OUT_DIR = "src/assets/icons/modules";

// Nome do arquivo de origem -> id do módulo em src/features/home/modules.ts
const MAP = {
  "condicionais.png": "condicionais",
  "devolucao-de-venda.png": "devolucao-venda",
};

// Exibido em ~64px CSS dentro do círculo de 84px (ver ModuleTile.css) — 256px
// cobre até telas de alta densidade sem exagero.
const TARGET_SIZE = 256;

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [file, id] of Object.entries(MAP)) {
    const src = `${SRC_DIR}/${file}`;

    await sharp(src)
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88 })
      .toFile(`${OUT_DIR}/${id}.webp`);

    const placeholder = await sharp(src)
      .resize(20, 20, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 40 })
      .toBuffer();

    writeFileSync(
      `${OUT_DIR}/${id}.placeholder.ts`,
      `export const ${camel(id)}_PLACEHOLDER =\n  "data:image/webp;base64,${placeholder.toString("base64")}";\n`,
    );

    console.log(id, "OK");
  }
}

function camel(id) {
  return id.toUpperCase().replace(/-/g, "_");
}

run();
