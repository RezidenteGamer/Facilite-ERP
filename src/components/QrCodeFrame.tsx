import { QRCodeSVG } from "qrcode.react";
import "./QrCodeFrame.css";

type QrCodeFrameProps = {
  /** A string a codificar — qualquer uma. Este componente não sabe do que ela é. */
  value: string;
  /** Lado do QR em pixels. Padrão 160. */
  size?: number;
  /** Texto do `aria-label`/`title` — o que o QR leva, em palavras. */
  title: string;
};

/**
 * Um QR Code dentro de uma moldura branca (D13, 10/09/2026).
 *
 * ## Por que a moldura é o componente, e não um detalhe de cada tela
 *
 * As telas internas do sistema têm fundo escuro, e um QR Code precisa de uma
 * **zona de silêncio clara** em volta para ser lido — sem ela, o leitor não
 * acha as bordas do símbolo. Essa regra não é decoração: é a mesma classe de
 * exigência que a zona de silêncio do Code 128 (ver `danfePdf.ts`). Deixá-la
 * escrita em cada tela que mostra um QR é convidar a próxima a esquecer.
 *
 * Nasceu de `PixQrCode` (D11), que era o único lugar do sistema com um QR e
 * carregava a moldura junto com a cobrança PIX inteira — payload por extenso,
 * botão "Copiar", texto de instrução. Quando Notas Emitidas precisou mostrar o
 * QR da NFC-e, a parte comum entre os dois casos era exatamente esta: uma
 * string virando QR sobre branco. `PixQrCode` continua existindo e agora usa
 * este componente; o que é específico do PIX ficou lá.
 */
export default function QrCodeFrame({ value, size = 160, title }: QrCodeFrameProps) {
  return (
    <div className="qr-frame" role="img" aria-label={title} title={title}>
      <QRCodeSVG value={value} size={size} level="M" />
    </div>
  );
}
