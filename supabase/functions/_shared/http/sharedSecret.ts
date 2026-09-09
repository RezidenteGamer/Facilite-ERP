/**
 * **Autenticação por segredo compartilhado num header — o padrão que A7 criou e
 * A8 passou a dividir.**
 *
 * Duas das portas deste backend não têm usuário do outro lado, e por isso não
 * podem usar a autenticação das outras: `has_permission` e `has_branch_access`
 * decidem por `auth.uid()`, e inventar um "usuário de serviço" com permissão
 * fiscal em todas as filiais recriaria exatamente a conta que A1 fechou.
 *
 * | porta | quem chama | header | variável |
 * | --- | --- | --- | --- |
 * | `fiscal-emit`, ação `sweep` (A7) | o `pg_cron` deste projeto | `x-fiscal-queue-secret` | `FISCAL_QUEUE_SECRET` |
 * | `fiscal-webhook` (A8) | a Focus NFe, quando um documento muda | configurável | `FISCAL_WEBHOOK_SECRET` |
 *
 * O desenho é o mesmo nos dois casos, e não por preguiça: é o **mesmo mecanismo
 * do outro lado também**. A Focus não assina o corpo da notificação — ao criar
 * o gatilho (`POST /hooks`) você escolhe o **nome do header**
 * (`authorization_header`) e o **valor** (`authorization`) que ela vai mandar em
 * toda chamada. Fonte: <https://doc.focusnfe.com.br/reference/criar_webhook>,
 * acesso em 09/09/2026.
 *
 * ## O que este segredo prova, e o que ele não prova
 *
 * Ele prova que **quem chamou conhece o segredo** — nada além disso. Não é
 * assinatura do corpo: um segredo estático não diz que aquele corpo veio da
 * Focus, só que o chamador tem a chave. É por isso que `fiscal-webhook` trata o
 * corpo da notificação como **aviso**, e não como verdade fiscal: ver o
 * cabeçalho de `fiscal-webhook/index.ts`.
 *
 * ## As duas disciplinas que o arquivo carrega
 *
 * 1. **Comparação em tempo constante.** `a === b` sai no primeiro byte
 *    diferente, e a diferença de tempo entre "errou no primeiro caractere" e
 *    "errou no último" é mensurável. Custa cinco linhas fechar isso, e é a única
 *    defesa que um segredo estático tem contra quem pode chamar o endpoint à
 *    vontade.
 * 2. **Falha fechada.** Sem a variável configurada a porta não abre: ela
 *    responde 503 e não roda. Uma função implantada antes de o segredo existir
 *    registra o erro em quem a chamou, em vez de rodar sem porteiro.
 */

/** Comparação de tempo constante entre dois segredos. */
export function segredosIguais(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

/**
 * A recusa a devolver, ou `null` quando o chamador passou.
 *
 * Devolve dado, e não `Response`, para caber num teste sem rede — quem chama
 * traduz em HTTP. Os dois códigos dizem coisas diferentes de propósito: **503**
 * é "esta porta não está configurada" (problema nosso, e o chamador deve
 * insistir depois), **401** é "você não é quem devia chamar" (problema dele).
 */
export type RecusaPorSegredo = { status: 503 | 401; error: string } | null;

export function decideAcessoPorSegredo(
  recebido: string | null,
  esperado: string | null | undefined,
  descricao: { porta: string; variavel: string },
): RecusaPorSegredo {
  const configurado = esperado?.trim();
  if (!configurado) {
    return {
      status: 503,
      error: `${descricao.porta} não está configurada (${descricao.variavel} ausente).`,
    };
  }
  if (!segredosIguais(recebido ?? "", configurado)) {
    return { status: 401, error: "Não autorizado." };
  }
  return null;
}
