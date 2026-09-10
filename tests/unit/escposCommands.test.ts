import { describe, expect, it } from "vitest";
import { INITIALIZE, PARTIAL_CUT, bold, concatBytes, drawerPulse, feedLines, justify } from "../../src/lib/printer/escposCommands";

// Todo byte esperado abaixo vem direto do "ESC/POS Command Reference for TM
// Printers" da Epson (download4.epson.biz/sec_pubs/pos/reference_en/escpos/),
// consultado página por página em 10/09/2026 — mesma disciplina de conferir
// contra a especificação pública, não contra a própria implementação, que
// D11 (CRC16 do Pix) e D13 (QR/Code128 do DANFE) usaram.

describe("INITIALIZE (ESC @)", () => {
  it("bate com 1B 40 — https://download4.epson.biz/.../esc_atsign.html", () => {
    expect(Array.from(INITIALIZE)).toEqual([0x1b, 0x40]);
  });
});

describe("bold (ESC E n)", () => {
  it("liga com 1B 45 01 — https://download4.epson.biz/.../esc_ce.html", () => {
    expect(Array.from(bold(true))).toEqual([0x1b, 0x45, 0x01]);
  });

  it("desliga com 1B 45 00", () => {
    expect(Array.from(bold(false))).toEqual([0x1b, 0x45, 0x00]);
  });
});

describe("justify (ESC a n)", () => {
  it("esquerda = 1B 61 00 — https://download4.epson.biz/.../esc_la.html", () => {
    expect(Array.from(justify("left"))).toEqual([0x1b, 0x61, 0x00]);
  });

  it("centro = 1B 61 01", () => {
    expect(Array.from(justify("center"))).toEqual([0x1b, 0x61, 0x01]);
  });

  it("direita = 1B 61 02", () => {
    expect(Array.from(justify("right"))).toEqual([0x1b, 0x61, 0x02]);
  });
});

describe("PARTIAL_CUT (GS V m, Function A)", () => {
  it("bate com 1D 56 01 (corte parcial) — https://download4.epson.biz/.../gs_cv.html", () => {
    expect(Array.from(PARTIAL_CUT)).toEqual([0x1d, 0x56, 0x01]);
  });
});

describe("drawerPulse (ESC p m t1 t2)", () => {
  it("pino 2 (padrão) = 1B 70 00 t1 t2, dentro do intervalo válido (0-255) — https://download4.epson.biz/.../esc_lp.html", () => {
    const bytes = Array.from(drawerPulse());
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x70);
    expect(bytes[2]).toBe(0x00); // pino 2 (drawer kick-out connector pin 2)
    expect(bytes[3]).toBeGreaterThanOrEqual(0);
    expect(bytes[3]).toBeLessThanOrEqual(255);
    expect(bytes[4]).toBeGreaterThanOrEqual(0);
    expect(bytes[4]).toBeLessThanOrEqual(255);
  });

  it("pino 5 quando pedido = 1B 70 01 ...", () => {
    expect(Array.from(drawerPulse(1)).slice(0, 3)).toEqual([0x1b, 0x70, 0x01]);
  });

  it("a nota da Epson recomenda t1 < t2 (ON mais curto que OFF) — nossos valores respeitam isso", () => {
    const bytes = Array.from(drawerPulse());
    expect(bytes[3]).toBeLessThan(bytes[4]);
  });
});

describe("feedLines", () => {
  it("gera N bytes de LF (0x0A)", () => {
    expect(Array.from(feedLines(3))).toEqual([0x0a, 0x0a, 0x0a]);
  });

  it("zero linhas = array vazio", () => {
    expect(Array.from(feedLines(0))).toEqual([]);
  });
});

describe("concatBytes", () => {
  it("concatena na ordem, sem perder nem embaralhar byte", () => {
    const result = concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])]);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });
});
