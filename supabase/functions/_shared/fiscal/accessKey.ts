/**
 * Montagem da chave de acesso de 44 dígitos da NF-e/NFC-e.
 *
 * A chave é **estruturalmente** real: mesmos campos, mesmas posições e o dígito
 * verificador calculado pelo módulo 11 de verdade — então um leitor de código
 * de barras, um `substring` ou uma validação de DV feita por um módulo futuro
 * se comportam como se comportariam com uma chave autorizada. O que ela não é,
 * e não precisa ser, é uma chave **emitida**: os dígitos vêm do CNPJ da filial e
 * de um contador local, não de uma autorização da SEFAZ.
 *
 * Layout (Manual de Orientação do Contribuinte, seção da chave de acesso):
 *
 * | Posição | Tam. | Campo                                        |
 * | ------- | ---- | -------------------------------------------- |
 * | 1-2     | 2    | cUF — código IBGE da UF do emitente           |
 * | 3-6     | 4    | AAMM — ano e mês da emissão                   |
 * | 7-20    | 14   | CNPJ do emitente                              |
 * | 21-22   | 2    | mod — 55 (NF-e) ou 65 (NFC-e)                 |
 * | 23-25   | 3    | série                                         |
 * | 26-34   | 9    | nNF — número da nota                          |
 * | 35      | 1    | tpEmis — forma de emissão (1 = normal)        |
 * | 36-43   | 8    | cNF — código numérico                         |
 * | 44      | 1    | cDV — dígito verificador (módulo 11)          |
 */

import type { FiscalModel } from "./types.ts";

/** Códigos IBGE de UF, usados quando a filial não tem `codigo_ibge_municipio`. */
const UF_CODES: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17",
  MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27",
  SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41",
  SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

/** 55 = NF-e, 65 = NFC-e. */
export const MODEL_CODES: Record<FiscalModel, string> = { nfe: "55", nfce: "65" };

/** Mantém só dígitos — CNPJ chega formatado ("00.000.000/0001-91") do cadastro. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function padLeft(value: string | number, size: number): string {
  return String(value).replace(/\D/g, "").padStart(size, "0").slice(-size);
}

/**
 * Dígito verificador da chave, módulo 11 com pesos 2..9 ciclando da direita
 * para a esquerda. Resto 0 ou 1 devolve DV 0 — a regra do MOC, não um atalho.
 */
export function accessKeyCheckDigit(key43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = key43.length - 1; i >= 0; i -= 1) {
    sum += Number(key43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder <= 1 ? 0 : 11 - remainder;
}

/** Resolve o cUF a partir do código IBGE do município (2 primeiros dígitos) ou da sigla da UF. */
export function resolveUfCode(input: { codigoIbgeMunicipio?: string | null; uf?: string | null }): string | null {
  const ibge = input.codigoIbgeMunicipio ? onlyDigits(input.codigoIbgeMunicipio) : "";
  if (ibge.length >= 2) return ibge.slice(0, 2);
  const uf = input.uf?.trim().toUpperCase();
  return uf ? (UF_CODES[uf] ?? null) : null;
}

export type AccessKeyParts = {
  /** Código IBGE da UF do emitente (2 dígitos). */
  ufCode: string;
  /** Data de emissão — de onde saem o ano e o mês. */
  issuedAt: Date;
  cnpj: string;
  model: FiscalModel;
  serie: number;
  numero: number;
  /** tpEmis: 1 = normal. O simulado não emite em contingência. */
  tpEmis?: number;
  /** cNF: código numérico de 8 dígitos. */
  codigoNumerico: number;
};

export function buildAccessKey(parts: AccessKeyParts): string {
  const year = String(parts.issuedAt.getFullYear()).slice(-2);
  const month = padLeft(parts.issuedAt.getMonth() + 1, 2);

  const key43 =
    padLeft(parts.ufCode, 2) +
    year +
    month +
    padLeft(parts.cnpj, 14) +
    MODEL_CODES[parts.model] +
    padLeft(parts.serie, 3) +
    padLeft(parts.numero, 9) +
    padLeft(parts.tpEmis ?? 1, 1) +
    padLeft(parts.codigoNumerico, 8);

  return key43 + String(accessKeyCheckDigit(key43));
}

/** Confere tamanho e DV. Existe para o teste do ciclo provar que a chave fecha. */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  return accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}
