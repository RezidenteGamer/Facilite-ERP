/**
 * Gera um DANFE e um DANFE NFC-e de exemplo em `.pdf`, para abrir e olhar.
 *
 * ```
 * deno run --allow-write=. scripts/danfe-pdf-preview.ts [pasta-de-saida]
 * ```
 *
 * ## Por que em Deno, e não em Node como os outros scripts daqui
 *
 * Este é o único script do diretório que roda no **mesmo runtime da Edge
 * Function** que gera o arquivo de verdade. Ele não fala com o banco, não
 * autentica e não escreve em lugar nenhum além do `.pdf` de saída: chama
 * `buildDanfePdfBytes` direto, com um payload inventado aqui dentro.
 *
 * Isso o torna a única verificação local possível do PDF **sem implantar**
 * `fiscal-emit`. O que ele prova: que a cadeia de módulos (`_shared/pdf/*` +
 * `danfePdf.ts`) carrega e roda em Deno, e que o arquivo produzido abre num
 * leitor de PDF. O que ele **não** prova: nada sobre a Edge Function em si —
 * roteamento, permissão, banco. Para isso só implantando.
 */

import { buildDanfePdfBytes } from "../supabase/functions/_shared/fiscal/danfePdf.ts";
import { buildSimulatedQrCodeUrl } from "../supabase/functions/_shared/fiscal/nfceQrCode.ts";
import type { SimulatedIssue } from "../supabase/functions/_shared/fiscal/simulatedArtifacts.ts";
import type { NfePayload } from "../supabase/functions/_shared/fiscal/types.ts";

const CHAVE = "35250912345678000199650010000000011000000017";

const payload = {
  natureza_operacao: "Venda de mercadoria adquirida ou recebida de terceiros",
  data_emissao: "2026-09-10T14:03:00-03:00",
  tipo_documento: 1,
  finalidade_emissao: 1,
  cnpj_emitente: "12345678000199",
  nome_emitente: "Comércio Simulado São João Ltda",
  nome_fantasia_emitente: "Simulado Store",
  logradouro_emitente: "Rua das Acácias",
  numero_emitente: "1500",
  bairro_emitente: "Centro",
  municipio_emitente: "São Paulo",
  uf_emitente: "SP",
  cep_emitente: "01310000",
  inscricao_estadual_emitente: "110042490114",
  regime_tributario_emitente: 3,
  nome_destinatario: "Maria da Conceição Ferrão",
  cpf_destinatario: "12345678909",
  logradouro_destinatario: "Avenida Paulista",
  numero_destinatario: "900",
  bairro_destinatario: "Bela Vista",
  municipio_destinatario: "São Paulo",
  uf_destinatario: "SP",
  cep_destinatario: "01311000",
  valor_produtos: 1234.5,
  valor_total: 1234.5,
  valor_desconto: 0,
  valor_frete: 0,
  icms_base_calculo: 1234.5,
  icms_valor_total: 222.21,
  valor_pis: 8.05,
  valor_cofins: 37.04,
  valor_total_tributos: 267.3,
  informacoes_adicionais_contribuinte:
    "Documento gerado pelo provedor simulado do Facilite ERP para conferência de layout.",
  items: [
    {
      numero_item: 1,
      codigo_produto: "PRD-001",
      descricao: "Camiseta algodão penteado — manga curta, tamanho M, cor azul-marinho",
      cfop: "5102",
      codigo_ncm: "61091000",
      unidade_comercial: "UN",
      quantidade_comercial: 3,
      valor_unitario_comercial: 249.9,
      valor_bruto: 749.7,
    },
    {
      numero_item: 2,
      codigo_produto: "PRD-002",
      descricao: "Calça jeans slim",
      cfop: "5102",
      codigo_ncm: "62034200",
      unidade_comercial: "UN",
      quantidade_comercial: 1,
      valor_unitario_comercial: 484.8,
      valor_bruto: 484.8,
    },
    {
      numero_item: 3,
      codigo_produto: "PRD-003",
      descricao: "Meia esportiva (par)",
      cfop: "5102",
      codigo_ncm: "61159600",
      unidade_comercial: "PC",
      quantidade_comercial: 2.5,
      valor_unitario_comercial: 19.9,
      valor_bruto: 49.75,
    },
  ],
} as unknown as NfePayload;

const base: SimulatedIssue = {
  chave: CHAVE,
  protocolo: "135260000000000001",
  model: "nfe",
  serie: 1,
  numero: 42,
  authorizedAt: new Date("2026-09-10T17:03:05Z"),
  payload,
  qrCodeUrl: null,
};

const outDir = Deno.args[0] ?? ".";
const saidas: [string, SimulatedIssue][] = [
  [`${outDir}/danfe-nfe-exemplo.pdf`, base],
  [
    `${outDir}/danfe-nfce-exemplo.pdf`,
    { ...base, model: "nfce", qrCodeUrl: buildSimulatedQrCodeUrl({ chave: CHAVE }) },
  ],
];

for (const [caminho, issue] of saidas) {
  const bytes = buildDanfePdfBytes(issue);
  await Deno.writeFile(caminho, bytes);
  console.log(`${caminho} — ${bytes.length} bytes`);
}
