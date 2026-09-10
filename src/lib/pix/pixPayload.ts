/**
 * BR Code (Pix Copia e Cola) estático — payload EMV® Merchant Presented QR,
 * perfil Pix, gerado inteiramente no cliente a partir da chave PIX da filial
 * (D11, 10/09/2026).
 *
 * Fonte primária pesquisada antes de codificar: "Manual de Padrões para
 * Iniciação do Pix" e "BR Code Manual" do Banco Central do Brasil
 * (bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
 * e bcb.gov.br/content/config/Documents/BR_Code_MANUAL_Version_2_May_2020.pdf).
 * O PDF do Bacen não é extraível como texto por ferramenta automática
 * (binário comprimido), então o layout de campos abaixo foi conferido contra
 * **dois exemplos completos e publicamente verificáveis**, de fontes
 * independentes entre si, reproduzidos em `tests/unit/pixPayload.test.ts`:
 * um payload sem valor fixo (chave "em aberto") e outro com valor fixo — os
 * dois batem byte a byte com o que `buildPixBRCode`/`crc16Ccitt` calculam
 * aqui, CRC16 incluído. O algoritmo do CRC (CRC-16/CCITT-FALSE) também foi
 * conferido contra o valor de checagem catalogado do próprio algoritmo
 * (`crc16Ccitt("123456789") === "29B1"`) — que não é específico do Pix, é uma
 * constante pública do CRC-16/CCITT-FALSE, então prova a implementação do
 * polinômio independentemente de qualquer exemplo de Pix.
 *
 * **Decisão sobre o campo `01` (Ponto de Iniciação):** os dois exemplos reais
 * usados para verificar o CRC **omitem** esse campo — e ainda assim têm CRC
 * correto, então ele é de fato opcional na prática (é opcional no EMVCo
 * genérico; o campo só existe para diferenciar reutilizável/`11` de
 * dinâmico-de-um-PSP/`12`). Mesmo assim esta função **inclui** `01=11`
 * explicitamente, porque é o que o Manual do Pix do Bacen documenta para o
 * arranjo Pix especificamente, e incluir o campo não quebra nenhum leitor —
 * é um TLV a mais que qualquer app de banco já sabe ler.
 *
 * Cada campo é TLV: **ID** (2 dígitos) + **TAMANHO** (2 dígitos, contagem de
 * caracteres do valor — o payload inteiro é ASCII depois da normalização,
 * então caracteres e bytes coincidem) + **VALOR**.
 *
 * Escopo desta função: só o modo **estático/reutilizável** (Ponto de
 * Iniciação `11`). O modo `12` (dinâmico, com URL de um PSP) não existe aqui
 * de propósito — é o que a tarefa D11 chama de fora de escopo.
 */

/** `ID + TAMANHO(2) + VALOR` — o bloco básico de todo campo do BR Code. */
function emvField(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/**
 * CRC-16/CCITT-FALSE: polinômio `0x1021`, valor inicial `0xFFFF`, sem
 * reflexão de entrada/saída, sem XOR final. É o algoritmo que o campo `63`
 * do BR Code exige, e o cálculo cobre o payload **inteiro até e incluindo**
 * o literal `6304` (ID+tamanho do próprio campo de CRC) — por isso quem
 * chama esta função já concatenou `"6304"` no fim da string antes de passar
 * pra cá (ver `buildPixBRCode`).
 */
export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Nome/cidade do recebedor (campos `59`/`60`) precisam ser ASCII puro — sem
 * acento, sem caractere fora do intervalo imprimível. Remove acentos via
 * `normalize("NFD")` (separa a letra do diacrítico) e descarta o que sobrar
 * fora de `0x20`–`0x7E`, depois trunca no tamanho máximo do campo.
 */
export function normalizePixText(value: string, maxLength: number): string {
  const stripped = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  return stripped.slice(0, maxLength);
}

/**
 * Reference Label (campo `62`/`05`, o "txid"). Sanitizado para alfanumérico
 * e truncado a 25 caracteres — é o que `PixChargeModal.tsx` usa ao montar o
 * txid a partir do código do lançamento. Vazio (ou só símbolos) vira
 * `"***"`, o valor que o BR Code usa para "sem identificador específico".
 */
export function sanitizePixTxid(value: string | null | undefined, maxLength = 25): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9]/g, "");
  return cleaned ? cleaned.slice(0, maxLength) : "***";
}

/**
 * Maior tamanho que a CHAVE em si pode ter dentro do payload: o template
 * `26` (Merchant Account Information) tem limite de 99 caracteres no total;
 * o subcampo fixo do GUI (`00` + `14` + `"br.gov.bcb.pix"`) já consome 18
 * deles, sobrando 81 para o subcampo `01` (a chave) — e esse subcampo carrega
 * seu próprio cabeçalho de 4 caracteres (`01` + tamanho de 2 dígitos), então
 * a chave em si tem até `81 - 4 = 77` caracteres. Nenhuma chave PIX real
 * (CPF, CNPJ, e-mail, telefone, UUID aleatório) chega perto disso — este
 * limite é uma proteção estrutural do formato TLV (achado do `/code-review
 * alto`: sem ele, uma chave malformada longa o bastante faria o campo `26`
 * passar de 99 caracteres e o prefixo de tamanho de 2 dígitos do `emvField`
 * estourar, corrompendo todo campo seguinte), não uma validação de formato
 * — `branches.ts` continua sem checar CPF/CNPJ/e-mail/telefone/UUID.
 */
const PIX_KEY_MAX_LENGTH_IN_PAYLOAD = 77;

export type PixChargeInput = {
  /** Chave PIX do recebedor — CPF/CNPJ/e-mail/telefone/aleatória, sem validação de formato (ver `branches.ts`). */
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  /** Ausente/`null`/`<= 0` = cobrança "em aberto", sem valor fixo (campo `54` omitido). */
  amount?: number | null;
  /** Vira `"***"` quando ausente — ver `sanitizePixTxid`. */
  txid?: string | null;
};

/**
 * Monta a string "Pix Copia e Cola" completa (BR Code estático), pronta para
 * virar QR Code ou ser copiada. Lança se a chave PIX vier vazia — não há
 * cobrança possível sem ela.
 */
export function buildPixBRCode(input: PixChargeInput): string {
  const pixKeyDigitado = input.pixKey.trim();
  if (!pixKeyDigitado) throw new Error("Chave PIX não informada.");

  /*
   * O payload inteiro precisa ser ASCII para o comprimento em caracteres
   * (`value.length`) coincidir com o comprimento em bytes que o campo TLV
   * declara — `normalizePixText` já fazia essa garantia para nome/cidade, e
   * até o /code-review alto apontar (achado real, corrigido aqui) a chave em
   * si escapava dessa normalização. Uma chave com acento (erro de
   * copiar-e-colar, já que `branches.ts` não valida formato) quebraria essa
   * contagem e corromperia o CRC e todo campo depois do `26`.
   */
  const pixKey = normalizePixText(pixKeyDigitado, PIX_KEY_MAX_LENGTH_IN_PAYLOAD);
  if (!pixKey) throw new Error("Chave PIX não informada.");

  const merchantName = normalizePixText(input.merchantName, 25) || "NAO INFORMADO";
  const merchantCity = normalizePixText(input.merchantCity, 15) || "NAO INFORMADO";
  const txid = sanitizePixTxid(input.txid);

  const merchantAccountValue = emvField("00", "br.gov.bcb.pix") + emvField("01", pixKey);

  const amountField =
    Number.isFinite(input.amount) && (input.amount as number) > 0
      ? emvField("54", (input.amount as number).toFixed(2))
      : "";

  const withoutCrc =
    emvField("00", "01") +
    emvField("01", "11") +
    emvField("26", merchantAccountValue) +
    emvField("52", "0000") +
    emvField("53", "986") +
    amountField +
    emvField("58", "BR") +
    emvField("59", merchantName) +
    emvField("60", merchantCity) +
    emvField("62", emvField("05", txid)) +
    "6304";

  return withoutCrc + crc16Ccitt(withoutCrc);
}
