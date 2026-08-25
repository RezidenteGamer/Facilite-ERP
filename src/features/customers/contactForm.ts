import type { NewContactInput } from "./useContactsData";

/**
 * Valores crus do formulário genérico (`RegistryFormModal`) → entrada do
 * repositório de contatos.
 *
 * Mora fora da página de Clientes e Fornecedores porque o cadastro rápido do
 * campo Cliente (Realizar Venda) grava exatamente o mesmo contato, pelo mesmo
 * formulário — duas cópias deste mapeamento sairiam do lugar na primeira
 * coluna nova.
 */
export function contactInputFromFormValues(values: Record<string, string>): NewContactInput {
  return {
    name: values.name ?? "",
    document: values.document ?? "",
    active: true,
    logradouro: values.logradouro || undefined,
    numero: values.numero || undefined,
    bairro: values.bairro || undefined,
    municipio: values.municipio || undefined,
    uf: values.uf || undefined,
    cep: values.cep || undefined,
    rg: values.rg || undefined,
    birthDate: values.birthDate || undefined,
    phone: values.phone || undefined,
    email: values.email || undefined,
    whatsapp: values.whatsapp || undefined,
    inscricaoEstadual: values.inscricaoEstadual || undefined,
    indicadorIe: values.indicadorIe || undefined,
    codigoIbgeMunicipio: values.codigoIbgeMunicipio || undefined,
  };
}
