import { describe, expect, it } from "vitest";
import {
  buildPixBRCode,
  crc16Ccitt,
  normalizePixText,
  sanitizePixTxid,
} from "../../src/lib/pix/pixPayload";

describe("crc16Ccitt", () => {
  it("bate com o valor de checagem catalogado do CRC-16/CCITT-FALSE — não é específico de Pix", () => {
    // Constante pública do algoritmo (poly 0x1021, init 0xFFFF, sem reflexão,
    // sem XOR final): todo implementação correta de CRC-16/CCITT-FALSE
    // devolve 29B1 para a string de teste "123456789". Prova o polinômio
    // independentemente de qualquer exemplo de BR Code.
    expect(crc16Ccitt("123456789")).toBe("29B1");
  });

  it("bate com um BR Code real publicado (chave aleatória, sem valor fixo, txid '***')", () => {
    // Exemplo amplamente reproduzido em documentação e geradores
    // independentes de Pix (ex.: guias de "entendendo o payload do Pix" e
    // decodificadores online) — chave "123e4567-e12b-12d1-a456-426655440000",
    // "Fulano de Tal" / "BRASILIA", sem campo 54 (cobrança em aberto).
    const semCrc =
      "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
    expect(crc16Ccitt(semCrc)).toBe("1D3D");
  });

  it("bate com um segundo BR Code real publicado, independente do primeiro (com valor fixo)", () => {
    // Segundo exemplo, de fonte distinta do anterior — chave
    // "bee05743-4291-4f3c-9259-595df1307ba1", valor R$10,00, "Alexandre Lima"
    // / "Presidente Prudente", txid "Um-Id-Qualquer".
    const semCrc =
      "00020126580014br.gov.bcb.pix0136bee05743-4291-4f3c-9259-595df1307ba1520400005303986540510.005802BR5914Alexandre Lima6019Presidente Prudente62180514Um-Id-Qualquer6304";
    expect(crc16Ccitt(semCrc)).toBe("D475");
  });
});

describe("normalizePixText", () => {
  it("remove acento e trunca no tamanho do campo", () => {
    expect(normalizePixText("São João da Boa Vista", 15)).toBe("Sao Joao da Boa");
    expect(normalizePixText("Açucena", 25)).toBe("Acucena");
  });

  it("remove caractere fora do ASCII imprimível", () => {
    expect(normalizePixText("Café ☕ Ltda", 20)).toBe("Cafe  Ltda");
  });
});

describe("sanitizePixTxid", () => {
  it("mantém só alfanumérico e trunca em 25", () => {
    expect(sanitizePixTxid("AB-12/CD-34")).toBe("AB12CD34");
  });

  it("vira '***' quando vazio, nulo ou só símbolos", () => {
    expect(sanitizePixTxid(null)).toBe("***");
    expect(sanitizePixTxid(undefined)).toBe("***");
    expect(sanitizePixTxid("")).toBe("***");
    expect(sanitizePixTxid("---///")).toBe("***");
  });

  it("trunca em 25 caracteres mesmo com entrada bem maior", () => {
    const longo = "A".repeat(40);
    expect(sanitizePixTxid(longo)).toHaveLength(25);
  });
});

describe("buildPixBRCode", () => {
  it("monta os mesmos dados do BR Code real (chave, nome, cidade) na ordem certa, com o campo 01 incluído", () => {
    // Os dois exemplos reais verificados acima (CRC 1D3D/D475) OMITEM o campo
    // `01` (Ponto de Iniciação) — confirma que ele é aceito como ausente por
    // pelo menos dois geradores/decodificadores de Pix na prática. Mas o
    // esqueleto de campos da tarefa pede o campo `01='11'` explicitamente
    // (é o que o Manual do Bacen documenta para o arranjo Pix especificamente,
    // diferente do EMVCo genérico onde ele é opcional), e incluí-lo não quebra
    // nenhum leitor — um campo TLV a mais que os apps de banco já esperam.
    // Este teste reconstrói o mesmo payload à mão (mesma chave/nome/cidade do
    // primeiro exemplo real, PORÉM com `010211` incluído) e usa o `crc16Ccitt`
    // já provado correto acima para fechar o CRC esperado — o que fica sob
    // teste aqui é a ORDEM e o TAMANHO de cada campo, não o CRC em si.
    const prefixoEsperado =
      "000201" +
      "010211" +
      "26580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000" +
      "52040000" +
      "5303986" +
      "5802BR" +
      "5913Fulano de Tal" +
      "6008BRASILIA" +
      "62070503***" +
      "6304";
    const payload = buildPixBRCode({
      pixKey: "123e4567-e12b-12d1-a456-426655440000",
      merchantName: "Fulano de Tal",
      merchantCity: "BRASILIA",
    });
    expect(payload).toBe(prefixoEsperado + crc16Ccitt(prefixoEsperado));
  });

  it("inclui o campo 54 (valor) só quando um valor fixo é passado", () => {
    const comValor = buildPixBRCode({
      pixKey: "chave@exemplo.com",
      merchantName: "Loja",
      merchantCity: "SAO PAULO",
      amount: 25.7,
    });
    expect(comValor).toContain("540525.70");

    const semValor = buildPixBRCode({
      pixKey: "chave@exemplo.com",
      merchantName: "Loja",
      merchantCity: "SAO PAULO",
    });
    expect(semValor).not.toContain("54");
  });

  it("valor zero ou negativo é tratado como 'em aberto' (campo 54 omitido)", () => {
    const payload = buildPixBRCode({
      pixKey: "chave@exemplo.com",
      merchantName: "Loja",
      merchantCity: "SAO PAULO",
      amount: 0,
    });
    expect(payload).not.toMatch(/5405\d/);
  });

  it("normaliza acento no nome/cidade da filial antes de montar o payload", () => {
    const payload = buildPixBRCode({
      pixKey: "11999998888",
      merchantName: "Padaria São José",
      merchantCity: "São Paulo",
    });
    expect(payload).toContain("Padaria Sao Jose");
    expect(payload).toContain("Sao Paulo");
  });

  it("sanitiza o txid recebido (alfanumérico, até 25 caracteres)", () => {
    const payload = buildPixBRCode({
      pixKey: "11999998888",
      merchantName: "Loja",
      merchantCity: "Curitiba",
      txid: "Venda-042/2026",
    });
    expect(payload).toContain("Venda0422026");
  });

  it("recusa chave PIX vazia", () => {
    expect(() =>
      buildPixBRCode({ pixKey: "   ", merchantName: "Loja", merchantCity: "Curitiba" }),
    ).toThrow();
  });

  it("normaliza acento na própria chave PIX antes de montar o payload (achado do code-review)", () => {
    // Nenhum formato real de chave tem acento, mas branches.ts não valida
    // formato — um "e-mail" digitado com acento por engano não pode corromper
    // a contagem de caracteres do campo 26 (que assume ASCII puro).
    const payload = buildPixBRCode({
      pixKey: "usuário@exemplo.com",
      merchantName: "Loja",
      merchantCity: "Curitiba",
    });
    expect(payload).toContain("usuario@exemplo.com");
    expect(payload).not.toContain("á");
  });

  it("trunca uma chave PIX absurdamente longa em vez de estourar o prefixo de tamanho do campo 26", () => {
    // Uma chave com mais de 77 caracteres faria o subcampo "01" sozinho já
    // passar dos 99 caracteres do template do campo 26 — o prefixo de
    // tamanho do emvField (sempre 2 dígitos) não tem como representar isso,
    // e sem truncar o payload inteiro sairia corrompido a partir daqui.
    const chaveEnorme = "a".repeat(120);
    const payload = buildPixBRCode({
      pixKey: chaveEnorme,
      merchantName: "Loja",
      merchantCity: "Curitiba",
    });
    // "01" + tamanho (2 dígitos, "77") + até 77 "a"s — nunca mais que isso.
    expect(payload).toContain(`0177${"a".repeat(77)}`);
    expect(payload).not.toContain("a".repeat(78));
    const crcInformado = payload.slice(-4);
    const crcRecalculado = crc16Ccitt(payload.slice(0, -4));
    expect(crcInformado).toBe(crcRecalculado);
  });

  it("termina sempre com um CRC16 de 4 dígitos hexadecimais em maiúsculas, calculado sobre o próprio payload", () => {
    const payload = buildPixBRCode({
      pixKey: "11999998888",
      merchantName: "Loja Qualquer",
      merchantCity: "Curitiba",
      amount: 99.9,
      txid: "abc123",
    });
    const crcInformado = payload.slice(-4);
    const crcRecalculado = crc16Ccitt(payload.slice(0, -4));
    expect(crcInformado).toBe(crcRecalculado);
    expect(crcInformado).toMatch(/^[0-9A-F]{4}$/);
  });
});
