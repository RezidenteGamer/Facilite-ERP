/**
 * URL de consulta do QR Code da NFC-e — só o `SimulatedFiscalProvider` usa isto.
 *
 * Formato pelo MOC/Focus NFe: `<host de consulta>?p=<chave>|<versao>|<tpAmb>|<idCSC>|<hash>`,
 * onde `hash` é o SHA-1 (hex) de `chave + tpAmb + idCSC + CSC`. O CSC em si nunca
 * aparece na URL nem em payload/resposta — é configuração de conta no provedor
 * real (ver `types.ts`, `FiscalDocument.qrCodeUrl`). Como o simulado não tem CSC
 * nenhum, o hash aqui é só **estruturalmente plausível** (hex de 40 caracteres,
 * determinístico a partir da chave) — mesmo espírito da chave de acesso
 * estruturalmente real que `accessKey.ts` já gera: a forma importa, o conteúdo
 * não precisa ser válido de verdade. O host aponta para um domínio fictício de
 * homologação, nunca um endpoint real de SEFAZ.
 */

/** Hash hex de 40 caracteres, determinístico a partir de uma semente — não é SHA-1 de verdade. */
function plausibleHex40(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < seed.length; i += 1) {
    const c = seed.charCodeAt(i);
    h1 = (h1 ^ c) * 0x01000193 >>> 0;
    h2 = (h2 + c * 0x9e3779b1) >>> 0;
  }
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (part(h1) + part(h2) + part(h1 ^ h2) + part((h1 + h2) >>> 0) + part((h2 - h1) >>> 0)).slice(0, 40);
}

export function buildSimulatedQrCodeUrl(input: { chave: string }): string {
  const versaoQrCode = 2;
  const tpAmbiente = 2; // 1 = produção, 2 = homologação — o simulado nunca é produção.
  const idCsc = "000001";
  const hash = plausibleHex40(`${input.chave}|${tpAmbiente}|${idCsc}`);
  return `https://homologacao.nfce-simulado.facilite-erp.invalid/qrcode?p=${input.chave}|${versaoQrCode}|${tpAmbiente}|${idCsc}|${hash}`;
}
