-- E4 — Código de barras do produto: nasce `products.gtin`
-- (10/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada**, pela mesma regra de D1,
-- A11 e D3: a sessão que a escreveu não tinha autorização para aplicar
-- migration nenhuma, por nenhum meio.
--
-- ## O que existia antes: nada
--
-- `products` não tem, e nunca teve, coluna de código de barras — conferido no
-- schema completo da tabela. O que existe é `products.code`, que é outra
-- coisa: um sequencial de três dígitos por filial ("001", "002"...), gerado
-- por `nextProductCode` no front, útil para o operador se referir ao produto e
-- sem relação nenhuma com o código impresso na embalagem pelo fabricante.
--
-- Duas telas já prometiam o contrário ao operador, e é isso que esta tarefa
-- vem pagar:
--
--   * o campo de busca do PDV diz `"Buscar produto por nome ou código
--     (scanner)..."`;
--   * o do `ProductPickerPanel` (Realizar Venda, Ajuste de Estoque) diz
--     `"Nome, código ou código de barras"`.
--
-- Os dois filtravam só `description` e `code`. Passar o leitor num produto não
-- achava nada, porque não havia o que casar.
--
-- ## Por que `gtin`, e não `barcode` ou `ean`
--
-- **GTIN** (Global Trade Item Number) é o nome que a GS1 — a entidade dona do
-- padrão — dá ao número em si, independente de como ele é impresso. "Código de
-- barras" é o desenho; "EAN-13" é um dos quatro comprimentos. A coluna guarda
-- o número, então guarda um GTIN. É também o nome que a NF-e usa no campo
-- `cEAN` do item... que este sistema **não** preenche hoje (conferido: `cEAN`
-- não aparece em lugar nenhum do núcleo fiscal) — ver o fim deste arquivo.

-- ---------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------
--
-- `text`, nullable — a esmagadora maioria dos 49 produtos cadastrados hoje não
-- tem GTIN nenhum, e produto de fabricação própria, granel ou serviço nunca
-- vai ter. Nulo é o estado normal, não uma pendência.
--
-- `text` e não `numeric`/`bigint` porque **GTIN tem zeros à esquerda que são
-- parte do código** — `00000000` é um GTIN-8 aritmeticamente válido, e
-- `01234567890128` é um GTIN-14 que existe nos exemplos da própria GS1.
-- Guardar como número apagaria esses zeros e transformaria um código em outro.
-- Mesma armadilha que A9 já tinha documentado para o CNPJ `00000000000191`.

alter table public.products
  add column if not exists gtin text;

comment on column public.products.gtin is
  'GTIN (Global Trade Item Number) do produto — o número do código de barras impresso na embalagem pelo fabricante (E4, 10/09/2026). Aceita os quatro comprimentos da GS1: GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13) e GTIN-14. NÃO confundir com products.code, que é o sequencial interno de três dígitos por filial. É text, e não numérico, porque zeros à esquerda fazem parte do código. O dígito verificador é módulo 10 com pesos 3/1 alternados da direita para a esquerda, conforme GS1 General Specifications 17.0.1 secao 7.9.1 (Figura 7.9.1-1) — validado no formulário (src/lib/gtin.ts), nunca aqui: ver o porquê no corpo desta migration. Nulo é estado normal (produto de granel, servico ou fabricacao propria nao tem GTIN).';

-- ---------------------------------------------------------------------
-- 2. Unicidade por filial
-- ---------------------------------------------------------------------
--
-- Mesma forma de `products_branch_id_code_key`, que já existe nesta tabela:
-- o par (filial, código) é único, e não o código sozinho. Duas filiais podem
-- ter o mesmo produto cadastrado, cada uma com o seu registro — é assim que o
-- resto do sistema já trata `code`, e GTIN não é diferente.
--
-- **Nulo não colide com nulo, e não precisa de índice parcial para isso.**
-- Conferido na documentação do PostgreSQL antes de decidir a forma: "By
-- default, two null values are not considered equal in this comparison. That
-- means even in the presence of a unique constraint it is possible to store
-- duplicate rows that contain a null value in at least one of the constrained
-- columns." Ou seja, `unique (branch_id, gtin)` comum já permite quantos
-- produtos sem GTIN a filial quiser — que é o caso da quase totalidade do
-- cadastro atual. `NULLS NOT DISTINCT` (PG15+) faria exatamente o contrário do
-- que se quer aqui, e é por isso que não está escrito.
--
-- A unicidade não é capricho: o modo scanner do PDV só adiciona um produto
-- sozinho quando o código casa **exatamente um** resultado. Sem esta
-- constraint, dois cadastros com o mesmo GTIN (o caso clássico: alguém
-- cadastra o produto duas vezes) fariam o scan parar de funcionar para aquele
-- item sem ninguém entender por quê. Com ela, o erro aparece na hora do
-- cadastro, que é onde dá para corrigir.
--
-- `add constraint` não aceita `if not exists`; o bloco condicional faz o papel
-- e deixa a migration repetível.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_branch_id_gtin_key'
  ) then
    alter table public.products
      add constraint products_branch_id_gtin_key unique (branch_id, gtin);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Nenhum CHECK de formato — a mesma decisão de D11
-- ---------------------------------------------------------------------
--
-- Não há `check` de comprimento, de "só dígitos", nem de dígito verificador.
-- É deliberado, e é a mesma leitura que D11 fez para a chave PIX: um `CHECK`
-- errado recusa dado legítimo, e o banco é o pior lugar para descobrir isso —
-- some com o produto do cadastro inteiro, com uma mensagem de erro de
-- constraint que o operador não tem como interpretar.
--
-- No caso do GTIN o risco é concreto e tem nome: um `check (length(gtin) = 13)`
-- escrito por quem só conhece o EAN-13 do varejo recusaria o GTIN-14 da caixa
-- que chega do distribuidor e o GTIN-12 do produto importado — códigos
-- legítimos, impressos na embalagem, que o operador tem na mão.
--
-- A validação do dígito verificador existe e é séria, mas mora no formulário
-- (`src/lib/gtin.ts`, `validateProductFormValues`), onde ela consegue dizer
-- "este código tem um dígito trocado" em português e no campo certo. O banco
-- garante o que só ele pode garantir: que não existam dois produtos com o
-- mesmo GTIN na mesma filial.

-- ---------------------------------------------------------------------
-- 4. O campo na tela de Produtos
-- ---------------------------------------------------------------------
--
-- `sort_order` 22, o próximo livre depois dos 20/21 que D3 usou.
--
-- `show_in_table = false`: a tabela de Produtos já tem colunas demais, e um
-- número de 13 dígitos não ajuda ninguém a reconhecer um produto de relance.
-- `show_in_details` e `show_in_form` ficam `true` — é um dado que o operador
-- digita (ou lê com o próprio leitor, com o cursor no campo) e precisa
-- conferir na ficha.

insert into public.module_fields
  (module_id, field_key, label, data_type, is_required, sort_order, show_in_table, show_in_details, show_in_form, hint)
values
  ('produtos', 'gtin', 'Código de barras (GTIN)', 'text', false, 22, false, true, true,
   'O número impresso no código de barras da embalagem — 8, 12, 13 ou 14 dígitos. Não é o código interno do produto. Com o cursor neste campo, você pode ler o código com o próprio leitor em vez de digitar. Deixe vazio para produto sem código de barras (granel, serviço, fabricação própria).')
on conflict (module_id, field_key) do nothing;

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não preenche GTIN de produto nenhum.** Não há de onde: o dado não
--     existe em lugar algum deste banco, e `code` (o sequencial "001") não é
--     um GTIN disfarçado. Diferente de D3, que tinha `cost_price` como fonte
--     defensável para o backfill de `average_cost`, aqui qualquer backfill
--     seria invenção. Os 49 produtos nascem com `gtin` nulo, e o lojista
--     preenche passando o leitor no campo do cadastro.
--   * **Não põe GTIN na NF-e.** O item da NF-e tem os campos `cEAN` e
--     `cEANTrib` (que pedem o literal `SEM GTIN` quando não há código), e
--     **nenhum dos dois existe hoje** no núcleo fiscal deste sistema —
--     conferido, `cEAN` não aparece em nenhum arquivo. Ligar os dois é mexer
--     no payload fiscal, que desde A1 só se escreve pela Edge Function e com
--     bateria de teste própria; é tarefa de outra tarefa, não de E4, e o plano
--     não pede. A coluna fica pronta para quando for.
--   * **Não mexe na RLS de `products`.** GTIN é metadado do mesmo produto, não
--     segredo: a policy existente (`has_permission('produtos', ...)` +
--     `has_branch_access`) já é a certa para ele.
--   * **Não cria índice de busca.** A busca por GTIN do PDV e do
--     `ProductPickerPanel` roda **no cliente**, sobre a lista de produtos da
--     filial que já está carregada em memória (`useProductsData`) — não é
--     query nova ao banco. E a constraint de unicidade já cria um índice em
--     `(branch_id, gtin)` de qualquer forma, então uma busca exata por GTIN no
--     servidor, se algum dia existir, já nasce servida.
