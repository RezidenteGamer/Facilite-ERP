/**
 * Estado de conexão com a impressora térmica no React — a única ponte entre
 * a tela do PDV e a borda de hardware (`lib/printer/printerPort.ts`).
 * Tarefa E1/E2, 10/09/2026.
 *
 * Três estados que `PosPage.tsx` mostra ao operador (ver AGENTS.md — mesmo
 * espírito de A8/A11/D1, "construído e desligado com o motivo explicado"):
 * `"unsupported"` (navegador sem WebUSB/WebSerial — Firefox, Safari),
 * `"disconnected"` (suportado, mas nenhuma impressora pareada ou a pareada
 * não respondeu à reconexão silenciosa) e `"connected"`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPrinterApiSupported,
  isWebSerialSupported,
  isWebUsbSupported,
  pairSerialPrinter,
  pairUsbPrinter,
  reconnectPrinter,
  type PrinterConnection,
} from "../../lib/printer/printerPort";
import { buildDrawerPulseBytes, buildReceiptBytes, type ReceiptData } from "../../lib/printer/receiptEscpos";

export type PrinterStatus = "unsupported" | "disconnected" | "connecting" | "connected";

export function usePrinter() {
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  const [label, setLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<PrinterConnection | null>(null);

  // Reconexão silenciosa ao abrir o PDV — sem pedir gesto do usuário de
  // novo pra um dispositivo que ele já autorizou antes nesta máquina.
  useEffect(() => {
    if (!isPrinterApiSupported()) {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    reconnectPrinter()
      .then((connection) => {
        if (cancelled) return;
        if (connection) {
          connectionRef.current = connection;
          setLabel(connection.label);
          setStatus("connected");
        } else {
          setStatus("disconnected");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pair = useCallback(async (transport: "usb" | "serial") => {
    setStatus("connecting");
    setError(null);
    try {
      const connection = transport === "usb" ? await pairUsbPrinter() : await pairSerialPrinter();
      connectionRef.current = connection;
      setLabel(connection.label);
      setStatus("connected");
    } catch (err) {
      setStatus("disconnected");
      setError(err instanceof Error ? err.message : "Não foi possível parear a impressora.");
    }
  }, []);

  const write = useCallback(async (bytes: Uint8Array): Promise<boolean> => {
    const connection = connectionRef.current;
    if (!connection) {
      setError("Nenhuma impressora conectada.");
      return false;
    }
    try {
      await connection.write(bytes);
      return true;
    } catch (err) {
      // Falha de escrita normalmente significa que a impressora foi
      // desligada/desconectada — volta pra "disconnected" em vez de deixar
      // a tela mostrar "conectada" pra um dispositivo que não responde mais.
      connectionRef.current = null;
      setStatus("disconnected");
      setError(err instanceof Error ? err.message : "Falha ao imprimir — verifique a impressora.");
      return false;
    }
  }, []);

  const printReceipt = useCallback((receipt: ReceiptData) => write(buildReceiptBytes(receipt)), [write]);
  const openDrawer = useCallback(() => write(buildDrawerPulseBytes()), [write]);

  return {
    status,
    label,
    error,
    canPairUsb: isWebUsbSupported(),
    canPairSerial: isWebSerialSupported(),
    pair,
    printReceipt,
    openDrawer,
  };
}
