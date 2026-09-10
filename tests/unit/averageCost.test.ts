import { describe, expect, it } from "vitest";
import { calculateWeightedAverageCost } from "../../src/lib/purchases/averageCost";

describe("calculateWeightedAverageCost", () => {
  it("primeira compra de um produto: média nula/indefinida vira o custo unitário da compra", () => {
    expect(calculateWeightedAverageCost(0, null, 10, 5)).toBe(5);
    expect(calculateWeightedAverageCost(0, undefined, 10, 5)).toBe(5);
  });

  it("compra normal, com estoque e média já existentes", () => {
    // 10 unidades a 4 (média atual) + 10 unidades a 6 (compra) = 20 unidades a média 5
    expect(calculateWeightedAverageCost(10, 4, 10, 6)).toBe(5);
  });

  it("quantidade fracionária", () => {
    const result = calculateWeightedAverageCost(2.5, 10, 1.5, 20);
    expect(result).toBeCloseTo((2.5 * 10 + 1.5 * 20) / 4, 10);
  });

  it("estoque zerado antes da compra: média antiga não pesa nada, vira o custo unitário da compra", () => {
    expect(calculateWeightedAverageCost(0, 8, 5, 12)).toBe(12);
  });

  it("estoque negativo pré-existente sem sobra positiva após a compra: novo custo unitário vira a média", () => {
    expect(calculateWeightedAverageCost(-5, 10, 3, 7)).toBe(7); // -5 + 3 = -2
    expect(calculateWeightedAverageCost(-5, 10, 5, 7)).toBe(7); // -5 + 5 = 0
  });

  it("estoque negativo que a compra reverte para positivo: fórmula ponderada normal aplica", () => {
    // -2 unidades a média 10 + 10 unidades a 5 = 8 unidades a (-2*10 + 10*5)/8 = 3.75
    expect(calculateWeightedAverageCost(-2, 10, 10, 5)).toBeCloseTo(3.75, 10);
  });
});
