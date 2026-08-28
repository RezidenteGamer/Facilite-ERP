import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import FormField from "../../components/form/FormField";
import SearchCombobox from "../../components/form/SearchCombobox";
import { normalizeSearchText } from "../../lib/searchText";
import PhotoDropzone from "./PhotoDropzone";
import type { ModuleFieldDefinition } from "./types";
import "./RegistryFormModal.css";

type RegistryFormModalMediaField = {
  label: string;
  imageUrl?: string | null;
  hint?: string;
  uploading?: boolean;
  onFileSelected: (file: File) => void;
};

/**
 * Ponte para um campo de consulta a outro cadastro (ex.: o grupo tributário
 * ou o NCM de um produto) dentro do formulário genérico.
 *
 * Mesmo papel de `mediaField`: `module_fields` não tem um `dataType` de
 * consulta, e criar um seria generalizar o motor inteiro por causa de um
 * campo. O formulário renderiza o `SearchCombobox` e cuida do texto digitado;
 * quem consome só diz o que buscar e o que fazer com o escolhido.
 *
 * É lista (`lookupFields`, não `lookupField`) porque Produtos passou a
 * precisar de dois ao mesmo tempo (Grupo tributário e NCM) — mesmo salto que
 * `selectFields` já deu antes por motivo parecido. `key` só precisa ser único
 * dentro do formulário.
 */
type RegistryFormModalLookupField<TItem = unknown> = {
  key: string;
  label: string;
  /** Descrição do item já escolhido. Vazio = nada escolhido ainda. */
  value: string;
  isRequired?: boolean;
  searchPlaceholder?: string;
  fetchItems: (query: string) => Promise<TItem[]>;
  getKey: (item: TItem) => string;
  renderItem: (item: TItem) => { primary: string; secondary?: string };
  onSelect: (item: TItem) => void;
  /**
   * Desfaz a escolha quando o operador digita por cima dela. Sem isto o
   * formulário gravaria o item antigo enquanto mostra um texto novo — risco
   * que só existe porque o campo passou a ser digitável.
   */
  onClear?: () => void;
};

/**
 * Ponte para um `<select>` de opções fixas dentro do formulário genérico —
 * mesmo papel de `lookupField`/`mediaField`: `module_fields` não tem
 * `dataType: 'select'` (a engine só distingue `text`/`date` no `<input>`,
 * ver AGENTS.md), e criar um generalizaria o motor inteiro por causa de um
 * campo. Usado pelo estoque negativo do produto (três estados) e pelas
 * unidades comercial/tributável (lista curta vinda de `units_of_measure`).
 * `key` só precisa ser único dentro do formulário — vira parte do `id` do
 * `<select>` no DOM, já que agora pode haver mais de um.
 */
type RegistryFormModalSelectField = {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  onChange: (value: string) => void;
};

/**
 * `secondary` é o segundo campo `show_in_table` do módulo referenciado
 * (quando existe) — ex.: a descrição do CFOP, o nome da UF. Só existe para
 * dar contexto na busca; `label` continua sendo o que fica gravado como
 * rótulo curto em `references.labels` (tabela/ficha de quem referencia).
 */
type ReferenceOption = { value: string; label: string; secondary?: string };

/**
 * Campo de referência (`module_fields.reference_module_id`) — mesmo
 * `SearchCombobox` do `lookupFields`, mas sem busca em rede: as opções já
 * vieram inteiras em `referenceOptions` (`useModuleReferences`), então
 * `fetchItems` só filtra em memória. Existe porque um `<select>` nativo com
 * centenas de opções (ex.: os 601 códigos de CFOP) não é pesquisável — o
 * operador tinha que rolar a lista inteira procurando. Vale para qualquer
 * campo de referência, não só os grandes: um catálogo de 3 opções também
 * fica pesquisável, só que a busca some rápido demais para importar.
 */
/** "5101 — Venda de produção do estabelecimento", ou só "5101" sem `secondary`. */
function referenceDisplayText(option: ReferenceOption): string {
  return option.secondary ? `${option.label} — ${option.secondary}` : option.label;
}

function ReferenceField({
  field,
  options,
  value,
  onChange,
}: {
  field: ModuleFieldDefinition;
  options: ReferenceOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  /* Estado local, não sincronizado de fora: ao contrário de `lookupFields`
     (cujo valor mora em quem chama o modal), o valor de um campo de
     referência já vive em `values` deste mesmo componente — não há como ele
     mudar por fora enquanto o modal está aberto. */
  const [query, setQuery] = useState(() => {
    const selected = options.find((option) => option.value === value);
    return selected ? referenceDisplayText(selected) : "";
  });

  async function fetchItems(term: string): Promise<ReferenceOption[]> {
    const normalized = normalizeSearchText(term.trim());
    if (!normalized) return options.slice(0, 50);
    return options
      .filter(
        (option) =>
          normalizeSearchText(option.label).includes(normalized) ||
          (option.secondary && normalizeSearchText(option.secondary).includes(normalized)),
      )
      .slice(0, 50);
  }

  return (
    <SearchCombobox<ReferenceOption>
      id={`registry-form-reference-${field.accessorKey}`}
      label={field.isRequired ? `${field.label} *` : field.label}
      placeholder="Digite o código ou a descrição..."
      value={query}
      onChange={(text) => {
        setQuery(text);
        /* Digitar por cima da opção escolhida desfaz a escolha — o campo tem
           que mostrar o que vai ser gravado (mesma regra de `lookupFields`). */
        if (value) onChange("");
      }}
      fetchItems={fetchItems}
      getKey={(option) => option.value}
      renderItem={(option) => ({ primary: option.label, secondary: option.secondary })}
      onSelect={(option) => {
        onChange(option.value);
        setQuery(referenceDisplayText(option));
      }}
    />
  );
}

type RegistryFormModalProps = {
  title: string;
  fields: ModuleFieldDefinition[];
  initialValues?: Record<string, string>;
  submitLabel?: string;
  mediaField?: RegistryFormModalMediaField;
  lookupFields?: RegistryFormModalLookupField<any>[];
  selectFields?: RegistryFormModalSelectField[];
  /**
   * Opções dos campos de referência (`module_fields.reference_module_id`),
   * por `accessorKey`. Quando um campo tem lista aqui, ele deixa de ser
   * `<input>` de texto e vira um `SearchCombobox` pesquisável sobre os
   * registros do módulo apontado (`ReferenceField` abaixo) — senão o
   * formulário estaria pedindo que alguém colasse um uuid à mão, ou rolasse
   * um `<select>` nativo de centenas de opções (caso do CFOP) procurando a
   * certa.
   */
  referenceOptions?: Record<string, ReferenceOption[]>;
  /**
   * Conteúdo extra renderizado logo depois de um campo específico, por
   * `accessorKey` — ex.: a calculadora de margem de Produtos, que fica junto
   * do campo "Preço custo". `module_fields` não tem um conceito de "campo
   * com widget auxiliar"; criar um generalizaria o motor inteiro por causa de
   * um caso (mesma disciplina de `mediaField`/`lookupField`/`selectFields`,
   * ver AGENTS.md). Vem como função — não `ReactNode` puro — porque o widget
   * geralmente precisa ler e escrever outros campos do MESMO formulário (ex.:
   * ler "Preço custo" e escrever em "Preço venda"), e esse estado só existe
   * aqui dentro.
   */
  fieldExtras?: Record<
    string,
    (helpers: { values: Record<string, string>; setValue: (accessorKey: string, value: string) => void }) => ReactNode
  >;
  /**
   * Validação além de "preenchido/vazio" — mesmo papel do `validateRow` do
   * motor de lote (`RegistryBatchFormModal`). Devolve mensagens de erro
   * prontas (não nomes de campo); quem usa decide a regra (ex.: Financeiro
   * recusa "abc" ou valor <= 0 no campo Valor total).
   */
  validate?: (values: Record<string, string>) => string[];
  /**
   * Erro vindo de fora, depois do envio (ex.: a gravação falhou) — mostrado
   * junto dos erros de validação. Sem isto um `onSubmit` assíncrono que
   * rejeita deixa o formulário aberto sem dizer nada ao operador.
   */
  submitError?: string | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
};

/**
 * Formulário de criação/edição genérico: renderiza um `FormField` por campo
 * de metadados do módulo (`showInForm`), sem conhecer o domínio do módulo.
 * Usada tanto para "Novo" quanto "Editar" — a diferença é só `initialValues`.
 */
export default function RegistryFormModal({
  title,
  fields,
  initialValues,
  submitLabel = "Salvar",
  mediaField,
  lookupFields,
  selectFields,
  referenceOptions,
  fieldExtras,
  validate,
  submitError,
  onSubmit,
  onCancel,
}: RegistryFormModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.accessorKey] = initialValues?.[field.accessorKey] ?? "";
    }
    return initial;
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  /* O texto digitado em cada campo de consulta é do formulário, não de quem
     consome: `field.value` descreve o item **escolhido**, e os dois só
     coincidem enquanto ninguém estiver digitando uma busca nova. Uma
     assinatura estável (chave:valor de todos os lookups) como dependência do
     efeito, pelo mesmo motivo de `useModuleReferences`: o array é recriado a
     cada render de quem chama. */
  const [lookupQueries, setLookupQueries] = useState<Record<string, string>>(() =>
    Object.fromEntries((lookupFields ?? []).map((field) => [field.key, field.value])),
  );

  const lookupSignature = (lookupFields ?? []).map((field) => `${field.key}:${field.value}`).join("|");
  useEffect(() => {
    setLookupQueries(Object.fromEntries((lookupFields ?? []).map((field) => [field.key, field.value])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupSignature]);

  function handleSubmit() {
    const missing = fields
      .filter((field) => field.isRequired && !values[field.accessorKey]?.trim())
      .map((field) => field.label);
    for (const field of lookupFields ?? []) {
      if (field.isRequired && !field.value.trim()) missing.unshift(field.label);
    }

    const errors: string[] = [];
    if (missing.length > 0) {
      errors.push(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
    }
    errors.push(...(validate?.(values) ?? []));

    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    onSubmit(values);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {formErrors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            {submitError && <p className="registry-form-modal__error">{submitError}</p>}

            {mediaField && (
              <div className="registry-form-modal__media">
                <PhotoDropzone
                  imageUrl={mediaField.imageUrl}
                  hint={mediaField.hint ?? "Ou arraste para cá"}
                  uploading={mediaField.uploading}
                  onFileSelected={mediaField.onFileSelected}
                />
                <span className="registry-form-modal__media-label">{mediaField.label}</span>
              </div>
            )}

            <div className="registry-form-modal__fields">
              {lookupFields?.map((field) => (
                <SearchCombobox
                  key={field.key}
                  id={`registry-form-lookup-${field.key}`}
                  label={field.isRequired ? `${field.label} *` : field.label}
                  placeholder={field.searchPlaceholder}
                  value={lookupQueries[field.key] ?? field.value}
                  onChange={(text) => {
                    setLookupQueries((current) => ({ ...current, [field.key]: text }));
                    if (field.value) field.onClear?.();
                  }}
                  fetchItems={field.fetchItems}
                  getKey={field.getKey}
                  renderItem={field.renderItem}
                  onSelect={(item) => {
                    field.onSelect(item);
                    setLookupQueries((current) => ({ ...current, [field.key]: field.renderItem(item).primary }));
                  }}
                />
              ))}

              {selectFields?.map((select) => (
                <FormField
                  key={select.key}
                  id={`registry-form-select-${select.key}`}
                  label={select.label}
                  type="select"
                  options={select.options}
                  value={select.value}
                  onChange={select.onChange}
                  hint={select.hint}
                />
              ))}

              {fields.map((field) => {
                const options = field.referenceModuleId
                  ? referenceOptions?.[field.accessorKey]
                  : undefined;

                return (
                  <div key={field.accessorKey}>
                    {options ? (
                      <ReferenceField
                        field={field}
                        options={options}
                        value={values[field.accessorKey] ?? ""}
                        onChange={(value) =>
                          setValues((current) => ({ ...current, [field.accessorKey]: value }))
                        }
                      />
                    ) : (
                      <FormField
                        id={`registry-form-${field.accessorKey}`}
                        label={field.isRequired ? `${field.label} *` : field.label}
                        type={field.dataType === "date" ? "date" : "text"}
                        value={values[field.accessorKey] ?? ""}
                        onChange={(value) =>
                          setValues((current) => ({ ...current, [field.accessorKey]: value }))
                        }
                      />
                    )}
                    {fieldExtras?.[field.accessorKey]?.({
                      values,
                      setValue: (accessorKey, value) =>
                        setValues((current) => ({ ...current, [accessorKey]: value })),
                    })}
                  </div>
                );
              })}
            </div>

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
              >
                {submitLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
