import { useState } from "react";
import { onlyDigits } from "../../lib/fiscal/accessKey";
import { fetchCnpjData } from "../../lib/repositories/cnpjLookup";
import "./CnpjLookupField.css";

type CnpjLookupFieldProps = {
  values: Record<string, string>;
  setValue: (accessorKey: string, value: string) => void;
};

/**
 * Atalho opcional: com um CNPJ válido digitado em "Documento", busca razão
 * social e endereço na BrasilAPI e preenche os campos vazios do formulário —
 * nunca sobrescreve o que o operador já digitou. Some fora do modo CNPJ (CPF,
 * ou documento incompleto): não faz sentido buscar o que não existe.
 *
 * Mesmo padrão de `fieldExtras` da calculadora de margem de Produtos (ver
 * `MarginCalculator`): widget específico de um campo, não capacidade nova do
 * motor genérico.
 */
export default function CnpjLookupField({ values, setValue }: CnpjLookupFieldProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCnpj = onlyDigits(values.document ?? "").length === 14;
  if (!isCnpj) return null;

  function setIfEmpty(accessorKey: string, value: string | undefined) {
    if (value && !values[accessorKey]?.trim()) setValue(accessorKey, value);
  }

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCnpjData(values.document ?? "");
      setIfEmpty("name", data.name);
      setIfEmpty("logradouro", data.logradouro);
      setIfEmpty("numero", data.numero);
      setIfEmpty("bairro", data.bairro);
      setIfEmpty("municipio", data.municipio);
      setIfEmpty("uf", data.uf);
      setIfEmpty("cep", data.cep);
      setIfEmpty("phone", data.phone);
      setIfEmpty("codigoIbgeMunicipio", data.codigoIbgeMunicipio);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível buscar o CNPJ.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cnpj-lookup">
      <button type="button" className="cnpj-lookup__btn" disabled={loading} onClick={handleClick}>
        {loading ? "Buscando..." : "Buscar dados"}
      </button>
      <p className="cnpj-lookup__hint">
        {error ?? "Preenche nome e endereço automaticamente — você pode editar tudo antes de salvar."}
      </p>
    </div>
  );
}
