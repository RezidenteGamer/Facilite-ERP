/**
 * Tipos ambiente para WebUSB e WebSerial — nenhum dos dois está em
 * `lib.dom.d.ts` do TypeScript ~6.0.2 (conferido: `grep -r "USBDevice\|
 * SerialPort" node_modules/typescript/lib/lib.dom.d.ts` não encontra nada).
 * Só a superfície que `printerPort.ts` realmente usa está declarada aqui —
 * não é o pacote `@types/w3c-web-usb`/`@types/w3c-web-serial` inteiro, pelo
 * mesmo motivo de D13 ter evitado uma dependência nova para uma necessidade
 * pequena e isolada: menos peso, e nada pra desalinhar de uma versão externa.
 *
 * Assinaturas conferidas contra a documentação oficial (MDN), consultada
 * página por página em 10/09/2026:
 * https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
 */

interface USBOutTransferResult {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall" | "babble";
}

interface USBEndpoint {
  readonly endpointNumber: number;
  readonly direction: "in" | "out";
  readonly type: "bulk" | "interrupt" | "isochronous";
}

interface USBAlternateInterface {
  readonly interfaceClass: number;
  readonly interfaceSubclass: number;
  readonly endpoints: USBEndpoint[];
}

interface USBInterface {
  readonly interfaceNumber: number;
  readonly alternate: USBAlternateInterface;
}

interface USBConfiguration {
  readonly configurationValue: number;
  readonly interfaces: USBInterface[];
}

interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly opened: boolean;
  readonly configuration: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<USBOutTransferResult>;
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USB extends EventTarget {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
}

interface SerialPort extends EventTarget {
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface Serial extends EventTarget {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
}

interface Navigator {
  readonly usb?: USB;
  readonly serial?: Serial;
}
