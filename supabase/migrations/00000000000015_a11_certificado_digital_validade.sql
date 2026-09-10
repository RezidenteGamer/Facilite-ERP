-- A11 — Certificado digital: a validade entra no cadastro, o certificado não
-- (09/09/2026)
--
-- **Esta migration foi escrita e NÃO foi aplicada.** A sessão que a escreveu
-- não tinha autorização para aplicar migration nem para implantar Edge
-- Function. O front foi construído para funcionar nos dois estados do banco
-- (com e sem as colunas daqui) — ver a sondagem por grupos em
-- `branchesRepository.ts`, que desde A11 pergunta grupo a grupo em vez de
-- deduzir qual coluna faltou.
--
-- ## A regra que decide o desenho inteiro
--
-- **O arquivo `.pfx`/`.p12` e a senha dele não entram neste sistema.** Não há
-- coluna para eles aqui, não há bucket de Storage, e o formulário não os lê.
-- Um certificado A1 é a chave privada da empresa perante a SEFAZ: quem o tem
-- assina nota em nome dela.
--
-- Isso não é só prudência — é o desenho da Focus. Conferido em
-- `doc.focusnfe.com.br/reference/criar_empresa` e `.../atualizar_empresa`
-- (acesso em 09/09/2026):
--
--   * o certificado vai no **cadastro da empresa** (`POST`/`PUT /v2/empresas`),
--     como `arquivo_certificado_base64` (o PFX/P12 inteiro em base64) mais
--     `senha_certificado` — "obrigatória apenas se informado
--     arquivo_certificado_base64";
--   * ele **não** faz parte do payload de uma nota. `NfePayload` não tem nada
--     de certificado, e não vai ter;
--   * quem guarda o certificado, portanto, é a Focus. Guardá-lo aqui também
--     seria duplicar o ativo mais sensível do cliente sem ganhar nada.
--
-- E há um segundo motivo, decisivo: **não existe conta na Focus** (A12 não
-- aconteceu). Não há para onde mandar o arquivo. Uma coluna, um bucket ou um
-- "guarda por enquanto" nasceriam sendo o único lugar do mundo onde a chave
-- privada do cliente estaria fora do lugar dela.
--
-- Some-se a RLS: a policy `read accessible branches` deixa **todo** usuário
-- com acesso à filial ler a linha inteira. É o mesmo argumento que D1 usou
-- para não pôr credencial de SMTP em `branches` — e um certificado é pior que
-- uma senha de e-mail.
--
-- ## O que entra, então
--
-- Só o que a Focus **devolve** sobre o certificado, que é metadado e não
-- segredo: duas datas de validade e o CNPJ contido nele. Nenhum dos três é
-- confidencial (o CNPJ é público; a validade é fato de cadastro), e é
-- exatamente por isso que eles podem morar numa tabela que todo usuário da
-- filial lê.

-- ---------------------------------------------------------------------
-- 1. Validade do certificado
-- ---------------------------------------------------------------------
--
-- `date` e não `timestamptz`, de propósito. O que a tela faz com estas
-- colunas é uma conta de **dias inteiros** ("vence em 12 dias") contra um
-- limiar de 30 dias. Guardar hora e fuso traria precisão que ninguém usa e
-- uma classe de bug que morde: a diferença entre dois instantes atravessa
-- horário de verão e vira 29,96 dias onde deveria ser 30 — bem em cima do
-- limiar. Se a Focus devolver a data com hora, o Postgres trunca para o dia,
-- que é a leitura certa: o certificado vale o dia inteiro do vencimento.

alter table public.branches
  add column if not exists certificado_valido_de date;

alter table public.branches
  add column if not exists certificado_valido_ate date;

comment on column public.branches.certificado_valido_de is
  'Início da validade do certificado digital A1 desta filial — o campo certificado_valido_de da resposta da Focus (A11, 09/09/2026). PREENCHIDA PELA RESPOSTA DA FOCUS, o que é assunto de A12: hoje nenhum código deste sistema escreve nesta coluna. O arquivo do certificado e a senha dele NÃO são guardados em lugar nenhum deste sistema — quem guarda é a Focus.';

comment on column public.branches.certificado_valido_ate is
  'Fim da validade do certificado digital A1 desta filial — o campo certificado_valido_ate da resposta da Focus (A11, 09/09/2026). É a âncora do status derivado e do aviso de vencimento da tela de Filiais (limiar de 30 dias, calculado em branches.ts — NÃO existe coluna de status, porque "vencendo" vira "vencido" sozinho com o tempo e uma coluna guardando isso estaria errada no dia seguinte). PREENCHIDA PELA RESPOSTA DA FOCUS (A12); hoje nenhum código escreve aqui.';

-- ---------------------------------------------------------------------
-- 2. O CNPJ que está dentro do certificado
-- ---------------------------------------------------------------------
--
-- Serve para uma conferência só, e ela é mais sutil do que parece:
-- **comparar os 14 dígitos com o CNPJ da filial daria alarme falso em massa.**
-- Um certificado e-CNPJ da matriz assina nota das filiais — o que se exige é
-- que a **raiz** (8 primeiros dígitos) bata, não o CNPJ inteiro. A própria
-- Focus documenta esse desenho ao explicar `certificado_especifico`: sem ele,
-- "atualização de certificado é propagada para todas empresas com o mesmo CNPJ
-- base (matriz e filiais)", o que só faz sentido porque o mesmo certificado
-- serve as duas. `relacaoCnpjCertificado` em `branches.ts` implementa
-- exatamente isso, e só avisa quando a raiz diverge.

alter table public.branches
  add column if not exists certificado_cnpj text;

comment on column public.branches.certificado_cnpj is
  'CNPJ contido no certificado digital desta filial — o campo certificado_cnpj da resposta da Focus (A11, 09/09/2026). Existe para conferir contra branches.cnpj, comparando a RAIZ (8 primeiros dígitos) e não os 14: um certificado e-CNPJ da matriz assina nota das filiais, e comparar o CNPJ inteiro daria alarme falso em toda filial não-matriz. PREENCHIDA PELA RESPOSTA DA FOCUS (A12); hoje nenhum código escreve aqui.';

-- ---------------------------------------------------------------------
-- 3. `certificado_digital_ref`: mantida, vazia, e agora explicada
-- ---------------------------------------------------------------------
--
-- A coluna nasceu na etapa 0 dos campos fiscais (14/08/2026) como
-- "placeholder de referência ao certificado digital — sem upload nem lógica de
-- certificado, isso é de uma etapa de ativação fiscal futura". A etapa futura
-- é esta, e a pesquisa dela mostrou que **a premissa da coluna não se
-- confirmou**: no desenho da Focus não existe "referência ao certificado" para
-- guardar. O certificado é atributo da empresa cadastrada lá, identificada
-- pelo CNPJ — não há handle, id de arquivo ou token por certificado.
--
-- Três caminhos foram considerados, e o escolhido é o terceiro:
--
--   1. **reaproveitá-la** para guardar uma das datas ou o CNPJ do certificado —
--      recusado: o nome diria "ref" e o conteúdo seria outra coisa, que é como
--      nasce a próxima confusão;
--   2. **derrubá-la** — recusado: `drop column` é irreversível, esta sessão não
--      pode aplicar migration nenhuma (então a remoção ficaria pendente por
--      tempo indeterminado, com o repositório afirmando algo que o banco não
--      fez), e ela não custa nada onde está: nenhum código escreve, nenhum lê,
--      e a única filial deste banco a tem nula;
--   3. **deixá-la parada e escrever o que se sabe sobre ela** — feito abaixo.
--      Se A12 descobrir que precisa guardar alguma referência da empresa do
--      lado da Focus, esta é a casa pronta; se não precisar, a remoção é uma
--      linha, tomada com a informação completa.
--
-- Só o comentário muda. A coluna não é tocada.

comment on column public.branches.certificado_digital_ref is
  'Placeholder criado na etapa 0 dos campos fiscais (14/08/2026) e NUNCA usado: nenhum código escreve ou lê esta coluna. A pesquisa de A11 (09/09/2026) mostrou que a premissa dela não se confirma — no desenho da Focus não existe "referência ao certificado" para guardar: o certificado é atributo da empresa cadastrada lá (POST/PUT /v2/empresas), identificada pelo CNPJ, sem handle nem id por arquivo. Mantida vazia de propósito, para A12 decidir com informação completa se vira referência da empresa na Focus ou se é removida. NÃO é, e não deve virar, lugar de guardar o arquivo .pfx nem a senha dele.';

-- ---------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------
--
--   * **Não cria coluna para o arquivo do certificado nem para a senha.** É a
--     regra do cabeçalho, e é o item mais importante deste bloco. Nem `bytea`,
--     nem `text` com base64, nem "criptografado com pgsodium", nem coluna de
--     hash. O certificado não entra.
--   * **Não cria bucket de Storage.** "Guardar no Storage por enquanto" seria
--     a mesma coisa com outro nome, e com a agravante de o arquivo passar a
--     existir num lugar cujo controle de acesso é outro sistema.
--   * **Não cria coluna de status do certificado.** O status é derivado das
--     datas (`certificadoStatus` em `branches.ts`): "vencendo" vira "vencido"
--     sozinho, e uma coluna guardando isso estaria errada no dia seguinte ao
--     que foi gravada, a menos que algo a reescrevesse todo dia. Esse "todo
--     dia" é agendamento — infraestrutura que A7 construiu para outra coisa e
--     que A11 não deve construir para esta.
--   * **Não cria job de aviso de vencimento** (nem `pg_cron`, nem fila, nem
--     e-mail). O aviso de A11 é visual, na tela de Filiais.
--   * **Não cria `certificado_especifico`.** Existe na Focus e importa num ERP
--     multifilial, mas é comportamento da conta de lá, decidido no momento do
--     envio. Quem envia é A12; a coluna nasce com ela ou não nasce.
--   * **Não toca em `fiscal_numbering`, `fiscal_queue` nem na reserva de
--     A5-A10.**
--   * **Não muda regra de cálculo tributário.**
--   * **Não mexe na RLS de `branches`.** As três colunas novas são metadado
--     público (CNPJ e datas), e a policy existente já está certa para elas —
--     é justamente por não serem segredo que elas podem morar aqui.
