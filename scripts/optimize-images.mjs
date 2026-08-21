// Script único, executado manualmente para gerar os assets otimizados a
// partir dos originais. Não faz parte do build — os arquivos gerados é que
// ficam versionados. Depois de rodar, pode apagar (junto do `sharp` do
// devDependencies, se não for usado de novo).
import sharp from "sharp";
import { writeFileSync } from "node:fs";

// Fonte em qualidade "full" — fora do repo, ver .gitignore (mesma pasta de
// referência usada para outros assets de sistema, não módulos).
const ICON_SRC = "Recursos de Desenvolvimento/Sistema Geral/voltar-sistema-geral-png.png";
const BG_SRC = "src/assets/img/tela-de-login-cinematica.webp";

async function run() {
  // Ícone do BackTab: exibido no máximo a 44x44 CSS px (ver FloatingTabs.css).
  // Gera em ~5x pra cobrir telas de alta densidade sem exagero.
  const icon = sharp(ICON_SRC);
  const iconMeta = await icon.metadata();
  const iconTargetW = 220;
  const iconTargetH = Math.round((iconMeta.height / iconMeta.width) * iconTargetW);

  await sharp(ICON_SRC)
    .resize(iconTargetW, iconTargetH)
    .webp({ quality: 92 })
    .toFile("src/assets/icons/voltar-sistema-geral.webp");

  const iconPlaceholder = await sharp(ICON_SRC)
    .resize(16)
    .webp({ quality: 40 })
    .toBuffer();
  writeFileSync(
    "src/assets/icons/voltar-sistema-geral.placeholder.ts",
    `// Miniatura borrada (16px, gerada por scripts/optimize-images.mjs) usada como\n` +
      `// placeholder enquanto o ícone em tamanho real carrega.\n` +
      `export const BACK_ICON_PLACEHOLDER =\n` +
      `  "data:image/webp;base64,${iconPlaceholder.toString("base64")}";\n`,
  );

  // Fundo do login: mantém as dimensões (já batem com o uso em tela cheia),
  // só reduz a qualidade — a própria tela escurece as bordas por cima, então
  // não há perda perceptível.
  await sharp(BG_SRC).webp({ quality: 68 }).toFile("src/assets/img/tela-de-login-cinematica.optimized.webp");

  const bgPlaceholder = await sharp(BG_SRC).resize(24).blur(4).webp({ quality: 40 }).toBuffer();
  writeFileSync(
    "src/assets/img/tela-de-login-cinematica.placeholder.txt",
    `data:image/webp;base64,${bgPlaceholder.toString("base64")}`,
  );

  console.log("Ícone:", iconTargetW, "x", iconTargetH);
  console.log("OK");
}

run();
