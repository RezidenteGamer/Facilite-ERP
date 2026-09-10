import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { describe, expect, it } from "vitest";
import { buildQrMatrix, type QrErrorCorrection } from "../../supabase/functions/_shared/pdf/qrMatrix";
import { buildSimulatedQrCodeUrl } from "@fiscal-core/nfceQrCode.ts";

/**
 * O oráculo desta bateria é o **`qrcode.react`**, que já é dependência do
 * projeto desde D11 e empacota o `qrcodegen` do Nayuki — uma implementação da
 * ISO/IEC 18004 escrita por outra pessoa, mantida fora daqui e usada por muita
 * gente. Comparar a matriz do nosso codificador com a dele, módulo a módulo, é
 * o mesmo tipo de conferência que D11 fez com o CRC16: contra algo público e
 * independente, nunca contra a própria implementação.
 *
 * Duas condições são necessárias para a comparação ser justa — e as duas foram
 * descobertas fazendo o teste falhar primeiro:
 *
 * 1. `boostLevel: false`. Por padrão o `qrcode.react` **sobe** o nível de
 *    correção quando sobra espaço na mesma versão. Nosso codificador não sobe
 *    de propósito (o nível pedido é o nível usado, e o resultado é previsível).
 * 2. **Toda entrada testada precisa cair no modo byte.** O `qrcodegen` escolhe
 *    automaticamente o modo mais compacto: uma entrada só de maiúsculas,
 *    dígitos e espaço (`HELLO WORLD`, `AAAA…`) vira modo alfanumérico, que
 *    empacota 2 caracteres a cada 11 bits e produz uma matriz legitimamente
 *    diferente. Nosso codificador é só modo byte (ver o cabeçalho de
 *    `qrMatrix.ts`), então as entradas abaixo têm minúscula ou pontuação —
 *    exatamente como a URL da NFC-e, que é o caso real.
 */
function oracleMatrix(value: string, level: QrErrorCorrection): boolean[][] {
  const markup = renderToStaticMarkup(
    createElement(QRCodeSVG, { value, level, marginSize: 0, boostLevel: false }),
  );

  const viewBox = /viewBox="0 0 (\d+) \d+"/.exec(markup);
  if (!viewBox) throw new Error("SVG do qrcode.react sem viewBox — formato mudou.");
  const size = Number(viewBox[1]);

  // Dois `<path>`: o primeiro é o fundo, o segundo é o desenho dos módulos.
  const paths = [...markup.matchAll(/ d="([^"]*)"/g)].map((match) => match[1]);
  if (paths.length < 2) throw new Error("SVG do qrcode.react sem o path dos módulos — formato mudou.");

  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  // Cada corrida horizontal de módulos escuros vira `M<x> <y>h<n>v1H<x>z`
  // (ver `generatePath` no pacote) — daí a leitura de volta.
  const runs = [...paths[1].matchAll(/M(\d+)[ ,](\d+) ?h(\d+)v1H\d+z/g)];
  expect(runs.length).toBeGreaterThan(0);
  for (const run of runs) {
    const x = Number(run[1]);
    const y = Number(run[2]);
    const length = Number(run[3]);
    for (let i = 0; i < length; i += 1) modules[y][x + i] = true;
  }
  return modules;
}

function expectMatchesOracle(value: string, level: QrErrorCorrection) {
  const ours = buildQrMatrix(value, level);
  const theirs = oracleMatrix(value, level);
  expect(ours.size).toBe(theirs.length);
  // Comparar linha a linha (e não a matriz inteira de uma vez) faz o relatório
  // de falha apontar a linha divergente em vez de despejar 177 arrays.
  for (let y = 0; y < ours.size; y += 1) {
    expect({ y, row: ours.modules[y] }).toEqual({ y, row: theirs[y] });
  }
}

describe("buildQrMatrix", () => {
  it("bate com o qrcode.react numa entrada curta, nos quatro níveis de correção", () => {
    for (const level of ["L", "M", "Q", "H"] as const) {
      expectMatchesOracle("Hello, world!", level);
    }
  });

  it("bate com o qrcode.react na URL de consulta da NFC-e que o sistema realmente gera", () => {
    const url = buildSimulatedQrCodeUrl({ chave: "35250912345678000199650010000000011000000017" });
    expect(url.length).toBeGreaterThan(120); // Confirma que o caso testado é o grande de verdade.
    expectMatchesOracle(url, "M");
  });

  it("bate com o qrcode.react em tamanhos que forçam versões diferentes", () => {
    // A largura do campo de contagem de caracteres muda na versão 10 (8 bits
    // até a 9, 16 daí em diante) e os padrões de alinhamento aparecem a partir
    // da versão 2 — estes comprimentos cruzam as duas fronteiras.
    for (const length of [1, 8, 20, 60, 120, 180, 300, 500]) {
      expectMatchesOracle("a".repeat(length), "M");
    }
  });

  it("bate com o qrcode.react com acento (bytes UTF-8 de dois bytes)", () => {
    expectMatchesOracle("Emissão de nota — São João da Boa Vista/SP", "Q");
  });

  it("escolhe a menor versão que cabe, e o tamanho segue a fórmula da norma", () => {
    const pequeno = buildQrMatrix("a", "L");
    expect(pequeno.version).toBe(1);
    expect(pequeno.size).toBe(21);
    expect(pequeno.size).toBe(pequeno.version * 4 + 17);

    const grande = buildQrMatrix("a".repeat(300), "M");
    expect(grande.version).toBeGreaterThan(9);
    expect(grande.size).toBe(grande.version * 4 + 17);
  });

  it("recusa texto que não cabe nem na versão 40", () => {
    expect(() => buildQrMatrix("a".repeat(3000), "H")).toThrow(/grande demais/i);
  });
});
