/**
 * O tipo de conteúdo de cada artefato fiscal, num lugar só (D13, 10/09/2026).
 *
 * ## Por que uma constante, e não a string em cada lugar
 *
 * Antes de D13 o tipo do DANFE estava escrito à mão em **três** arquivos —
 * onde o artefato nasce (`simulatedArtifacts.ts`), onde a Edge Function relê a
 * linha do banco para reconciliar (`fiscal-emit/reconcile.ts`) e onde o front
 * relê a mesma linha para abrir o arquivo (`fiscalDocumentsRepository.ts`). Os
 * três diziam `"text/html"`, e os três precisavam mudar juntos.
 *
 * Isso é uma armadilha de manutenção com uma falha silenciosa muito específica:
 * se só o primeiro mudasse, um documento **nasceria** como PDF e, depois de
 * qualquer reconciliação (o botão "Consultar status" de A6, a varredura de A7,
 * o webhook de A8), voltaria a ser **rotulado** como HTML — a tela abriria os
 * bytes de um PDF dentro de um documento HTML, sem erro nenhum na interface.
 *
 * Com a constante, "mudar juntos" deixa de ser uma disciplina e vira o padrão:
 * existe um valor só, e os três importam dele.
 *
 * ## `application/pdf` significa base64
 *
 * `FiscalArtifact.content` é `string` e a coluna do banco é `text`; um PDF é
 * binário. A convenção deste contrato é: **artefato de tipo binário viaja em
 * base64 no campo `content`**, e `isBinaryArtifact` é quem responde isso.
 *
 * A alternativa considerada foi mandar *tudo* em base64, XML incluído, para
 * não haver ramo nenhum na leitura. Ficou de fora porque o XML é o artefato que
 * alguém abre no editor de texto e lê — na tabela e no banco —, e escondê-lo
 * atrás de base64 custaria essa legibilidade para poupar um `if`. O ramo mora
 * numa função só, testada, e não numa condição espalhada.
 */

/** XML da nota e dos eventos — texto puro, guardado como texto. */
export const XML_CONTENT_TYPE = "application/xml";

/** DANFE / DANFE NFC-e — PDF, guardado em base64 (ver o cabeçalho). */
export const DANFE_CONTENT_TYPE = "application/pdf";

/**
 * `true` quando o `content` do artefato está em base64 e precisa ser
 * decodificado antes de virar arquivo.
 *
 * Aceita a família `application/pdf` inteira (com parâmetros, como
 * `application/pdf; charset=binary`) porque o provedor real pode devolver o
 * cabeçalho do jeito dele.
 */
export function isBinaryArtifact(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() === DANFE_CONTENT_TYPE;
}

/**
 * base64 → bytes. O caminho de ida (`bytesToBase64`) mora em `_shared/pdf/pdfDocument.ts`.
 *
 * O retorno é `Uint8Array<ArrayBuffer>`, e não o `Uint8Array` genérico, porque
 * só essa forma é um `BlobPart` válido: o genérico admite `SharedArrayBuffer`,
 * que o `Blob` não aceita.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * O `content` de um artefato pronto para virar arquivo: **bytes** quando o
 * tipo é binário, a própria string quando é texto.
 *
 * Esta função é o ponto único onde a decisão acontece, e existe justamente
 * porque errá-la não dá erro nenhum na tela. `new Blob([content])` trata a
 * string como texto UTF-8: passar a string base64 direto gravaria os
 * **caracteres** `JVBERi0...` dentro de um arquivo rotulado `application/pdf`.
 * A aba abriria, o download aconteceria, e o arquivo estaria corrompido — só
 * um leitor de PDF reclamaria, longe daqui. Ver `tests/unit/fiscalArtifact.test.ts`.
 *
 * ## O documento antigo, emitido antes de D13
 *
 * `pdf_content` das notas já emitidas guarda **HTML**, e desde D13 a leitura
 * rotula toda linha como `application/pdf`. Sem o `try`, `atob` levantaria
 * `InvalidCharacterError` no primeiro caractere que não é base64 (`<`), dentro
 * do `onClick` de "Visualizar" — e erro em manipulador de evento do React não
 * é pego por `ErrorBoundary`: o botão simplesmente **não faria nada**, sem
 * mensagem nenhuma.
 *
 * O `catch` devolve o conteúdo como texto, que é o que ele de fato é. Quem
 * monta o `Blob` reconhece esse caso pelo tipo do retorno e rotula o arquivo
 * de acordo — ver `fiscalArtifactBlob`.
 */
export function decodeArtifactContent(content: string, contentType: string): Uint8Array<ArrayBuffer> | string {
  if (!isBinaryArtifact(contentType)) return content;
  try {
    return base64ToBytes(content);
  } catch {
    return content;
  }
}
