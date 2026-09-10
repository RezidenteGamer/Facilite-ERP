import { QRCodeSVG } from "qrcode.react";
import { useCopyToClipboard } from "../lib/useCopyToClipboard";
import "./PixQrCode.css";

type PixQrCodeProps = {
  /** A string "Pix Copia e Cola" inteira (BR Code) — ver `buildPixBRCode`. */
  payload: string;
};

/**
 * QR Code de uma cobrança PIX estática + a string "copia e cola" por extenso
 * + botão "Copiar" (D11, 10/09/2026).
 *
 * Componente isolado de propósito — não amarrado a Financeiro. É pura
 * apresentação de uma string já pronta (`buildPixBRCode`); não sabe de onde
 * o `payload` veio, então serve tanto para a ação "Cobrar via PIX" de
 * Financeiro quanto para um eventual QR no momento da venda (não construído
 * nesta tarefa — ver a decisão em AGENTS.md).
 *
 * `qrcode.react` foi a lib escolhida para gerar o QR (ver a decisão em
 * AGENTS.md): renderiza em SVG puro no cliente, sem chamada de rede
 * nenhuma, e é a opção mais usada especificamente em projetos React.
 */
export default function PixQrCode({ payload }: PixQrCodeProps) {
  const { copied, error, copy } = useCopyToClipboard();

  return (
    <div className="pix-qrcode">
      <div className="pix-qrcode__frame">
        <QRCodeSVG value={payload} size={220} level="M" />
      </div>

      <p className="pix-qrcode__code">{payload}</p>

      <button className="pix-qrcode__copy-btn" type="button" onClick={() => copy(payload)}>
        {copied ? "Copiado!" : "Copiar"}
      </button>
      {error ? (
        <p className="pix-qrcode__copy-hint" role="alert">
          Não foi possível copiar automaticamente — selecione o código acima e copie manualmente.
        </p>
      ) : (
        <p className="pix-qrcode__copy-hint">
          Escaneie o QR Code com o app do banco, ou copie o código e cole na opção "Pix Copia e Cola".
        </p>
      )}
    </div>
  );
}
