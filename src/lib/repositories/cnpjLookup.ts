import { onlyDigits } from "../fiscal/accessKey";

export type CnpjLookupResult = {
  name: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  phone?: string;
  codigoIbgeMunicipio?: string;
};

/**
 * Busca dados públicos de um CNPJ na BrasilAPI (gratuita, sem chave) para
 * pré-preencher o cadastro de contato. Uso é sempre opcional/manual — quem
 * chama decide quando disparar e nunca deve travar o formulário se isto
 * falhar (CNPJ inexistente, rede fora, etc.), por isso qualquer falha vira
 * um erro com mensagem amigável para exibição discreta.
 */
export async function fetchCnpjData(cnpj: string): Promise<CnpjLookupResult> {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) {
    throw new Error("Digite um CNPJ válido (14 dígitos) para buscar.");
  }

  let response: Response;
  try {
    response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  } catch {
    throw new Error("Não foi possível buscar o CNPJ agora. Verifique sua conexão.");
  }

  if (response.status === 404) {
    throw new Error("CNPJ não encontrado.");
  }
  if (!response.ok) {
    throw new Error("Não foi possível buscar o CNPJ agora. Tente novamente.");
  }

  const data = await response.json();

  return {
    name: data.razao_social || data.nome_fantasia || "",
    logradouro: data.logradouro || undefined,
    numero: data.numero || undefined,
    bairro: data.bairro || undefined,
    municipio: data.municipio || undefined,
    uf: data.uf || undefined,
    cep: data.cep || undefined,
    phone: data.ddd_telefone_1 || undefined,
    codigoIbgeMunicipio: data.codigo_municipio_ibge ? String(data.codigo_municipio_ibge) : undefined,
  };
}
