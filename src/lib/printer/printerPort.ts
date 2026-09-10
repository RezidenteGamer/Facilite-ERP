/**
 * Borda de hardware — a única parte do PDV que fala com `navigator.usb`/
 * `navigator.serial` de verdade (tarefa E1, 10/09/2026). Deliberadamente
 * fina: só sabe detectar suporte, listar/parear/abrir/escrever numa
 * impressora. Não sabe nada de ESC/POS (isso é `receiptEscpos.ts`) nem de
 * venda/PDV — pra qualquer outra tela do sistema, hardware de impressão
 * simplesmente não existe (ver AGENTS.md).
 *
 * **Sem teste automatizado.** `navigator.usb`/`navigator.serial` só existem
 * dentro de um Chromium de verdade, atrás de gesto do usuário — não há como
 * simular isso em Vitest (Node) sem um mock que provaria só que o mock
 * funciona, não que o código fala com hardware de verdade. Ver a seção de
 * limitações em AGENTS.md para o que foi (e não foi) verificado de fato.
 *
 * ## Por que WebUSB *e* WebSerial, e não só uma
 *
 * Impressora térmica barata aparece pro navegador de um jeito ou de outro
 * dependendo do chip que usa por dentro: um controlador USB genérico expõe
 * a impressora como dispositivo WebUSB puro; um adaptador serial-sobre-USB
 * (FTDI/CH340/CP210x, comuns em impressora chinesa sem marca) expõe uma
 * porta COM que só o WebSerial enxerga. Oferecer só uma das duas deixaria
 * parte do hardware real de fora — exigência explícita da tarefa.
 *
 * Fonte primária de cada API (consultada em 10/09/2026, mesma disciplina de
 * "fonte primária, não memória" de D11/D13):
 * https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
 *
 * ## A fronteira permanente: só Chromium, só HTTPS
 *
 * WebUSB e WebSerial só existem em navegadores baseados em Chromium (Chrome,
 * Edge, Opera — confirmado no MDN e no caniuse.com/web-serial em 10/09/2026;
 * Firefox e Safari não implementam nenhuma das duas, sem previsão) e só em
 * contexto seguro (HTTPS, ou `http://localhost` em desenvolvimento). Não é
 * um detalhe de implementação — é um limite que nenhuma quantidade de código
 * aqui contorna. `isPrinterApiSupported()` é o que permite a tela mostrar
 * isso com uma mensagem clara em vez de travar em silêncio (mesmo espírito
 * de A8/A11/D1: "construído e desligado com o motivo explicado").
 */

export type PrinterTransport = "usb" | "serial";

export type PrinterConnection = {
  transport: PrinterTransport;
  /** Texto pra mostrar na tela ("Impressora conectada: <label>"). */
  label: string;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.usb;
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.serial;
}

export function isPrinterApiSupported(): boolean {
  return isWebUsbSupported() || isWebSerialSupported();
}

/**
 * "Última impressora usada" — local ao navegador desta máquina, nunca no
 * Supabase. Um `USBDevice`/`SerialPort` não é um dado serializável nem
 * sincronizável entre PCs: cada terminal do chão de loja tem a impressora
 * física plugada nele, e o que fica pareado numa máquina não diz nada sobre
 * as outras (ver AGENTS.md — decisão tomada antes de escrever qualquer
 * código, ao pesquisar `cash_registers`).
 */
const STORAGE_KEY = "facilite:pos:printer";

type StoredPrinterRef = { transport: PrinterTransport; vendorId: number; productId: number };

function loadStoredRef(): StoredPrinterRef | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPrinterRef>;
    if (
      (parsed.transport === "usb" || parsed.transport === "serial") &&
      typeof parsed.vendorId === "number" &&
      typeof parsed.productId === "number"
    ) {
      return parsed as StoredPrinterRef;
    }
    return null;
  } catch {
    return null;
  }
}

function saveStoredRef(ref: StoredPrinterRef): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ref));
  } catch {
    // localStorage indisponível (aba anônima, cota cheia) — só perde a
    // reconexão silenciosa da próxima vez; o pareamento manual continua ok.
  }
}

async function openUsbConnection(device: USBDevice): Promise<PrinterConnection> {
  await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const configuration = device.configuration;
  if (!configuration) throw new Error("A impressora USB não expôs nenhuma configuração.");

  const target = configuration.interfaces
    .map((iface) => ({
      interfaceNumber: iface.interfaceNumber,
      endpoint: iface.alternate.endpoints.find((endpoint) => endpoint.direction === "out"),
    }))
    .find((candidate) => candidate.endpoint);
  if (!target?.endpoint) throw new Error("A impressora USB não expôs uma saída de dados (endpoint OUT).");
  const endpointNumber = target.endpoint.endpointNumber;

  await device.claimInterface(target.interfaceNumber);

  return {
    transport: "usb",
    label: device.productName?.trim() || `Impressora USB (${device.vendorId.toString(16)}:${device.productId.toString(16)})`,
    async write(bytes) {
      await device.transferOut(endpointNumber, bytes);
    },
    async close() {
      await device.close();
    },
  };
}

/**
 * Taxa de transmissão assumida pra impressora serial: 9600 bps é a
 * convenção mais comum entre impressoras ESC/POS com porta serial/adaptador
 * USB-serial — não é um valor normativo do WebSerial (a API só recebe o que
 * pedirmos, sem descobrir a taxa da impressora sozinha). Impressora
 * configurada numa taxa diferente (existe chavinha/menu de configuração pra
 * isso na maioria dos modelos) não vai imprimir corretamente por este
 * caminho — limitação que só um teste com hardware real revela (ver
 * AGENTS.md).
 */
const SERIAL_BAUD_RATE = 9600;

async function openSerialConnection(port: SerialPort): Promise<PrinterConnection> {
  await port.open({ baudRate: SERIAL_BAUD_RATE });
  const info = port.getInfo();
  const label =
    typeof info.usbVendorId === "number"
      ? `Impressora serial (${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)})`
      : "Impressora serial";

  return {
    transport: "serial",
    label,
    async write(bytes) {
      if (!port.writable) throw new Error("A porta serial não está pronta para escrita.");
      const writer = port.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
    },
    async close() {
      await port.close();
    },
  };
}

/**
 * Pareamento novo por WebUSB — só funciona chamada dentro de um gesto do
 * usuário (clique), exigência da própria API. `filters: []` é a forma
 * documentada de pedir "mostre todos os dispositivos USB conectados" — sem
 * isso o navegador exige `filters` não vazio, e não há um `vendorId`
 * universal de impressora térmica pra filtrar por.
 */
export async function pairUsbPrinter(): Promise<PrinterConnection> {
  if (!navigator.usb) throw new Error("Este navegador não suporta WebUSB.");
  const device = await navigator.usb.requestDevice({ filters: [] });
  saveStoredRef({ transport: "usb", vendorId: device.vendorId, productId: device.productId });
  return openUsbConnection(device);
}

/** Pareamento novo por WebSerial — mesma exigência de gesto do usuário. */
export async function pairSerialPrinter(): Promise<PrinterConnection> {
  if (!navigator.serial) throw new Error("Este navegador não suporta Web Serial.");
  const port = await navigator.serial.requestPort();
  const info = port.getInfo();
  if (typeof info.usbVendorId === "number" && typeof info.usbProductId === "number") {
    saveStoredRef({ transport: "serial", vendorId: info.usbVendorId, productId: info.usbProductId });
  }
  return openSerialConnection(port);
}

/**
 * Reconexão silenciosa — sem gesto do usuário, só com o que já foi
 * autorizado antes (`getDevices()`/`getPorts()`). Roda ao abrir o PDV;
 * devolve `null` quando não há impressora pareada nesta máquina ainda, ou
 * quando o dispositivo pareado não está mais conectado — os dois casos a
 * tela trata como "sem impressora", oferecendo o botão de parear de novo.
 */
export async function reconnectPrinter(): Promise<PrinterConnection | null> {
  const stored = loadStoredRef();
  if (!stored) return null;

  if (stored.transport === "usb" && navigator.usb) {
    const devices = await navigator.usb.getDevices();
    const match = devices.find((device) => device.vendorId === stored.vendorId && device.productId === stored.productId);
    if (match) return openUsbConnection(match);
  }

  if (stored.transport === "serial" && navigator.serial) {
    const ports = await navigator.serial.getPorts();
    const match = ports.find((port) => {
      const info = port.getInfo();
      return info.usbVendorId === stored.vendorId && info.usbProductId === stored.productId;
    });
    if (match) return openSerialConnection(match);
  }

  return null;
}
