# Facilite ERP — Tela de Login

Tela de login do Facilite (By SimpleSoft) em **React + TypeScript + Vite**,
já preparada (mas não conectada) para autenticação via **Supabase**.

## Como rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`.

```bash
npm run build     # build de produção em dist/
npm run preview   # serve o build de produção localmente
npm run lint       # oxlint
```

## Estrutura

```
index.html                        entry HTML do Vite (fontes Google Fonts no <head>)
src/
  main.tsx                        bootstrap do React
  App.tsx                         raiz da aplicação (hoje só renderiza LoginPage)
  index.css                       reset global e estilos de <body>
  features/
    auth/
      LoginPage.tsx                layout: card de suporte + card de login
      LoginForm.tsx                estado do formulário, validação, loading
      LoginPage.css                design tokens e todo o CSS da tela
  lib/
    supabaseClient.ts              cliente Supabase — null até as env vars existirem
  types/
    supabase.ts                   placeholder para os tipos gerados do schema
  assets/img/                     foto de fundo (cinematic shot da torre)
.env.example                      variáveis do Supabase (copiar para .env.local)
legacy-static/                    protótipo original em HTML/CSS/JS puro (referência)
Recursos de Desenvolvimento/      originais fornecidos
```

## Fontes

Carregadas do Google Fonts no `<head>` do `index.html`:

- **Leckerli One** — logomarca "Facilite", "SimpleSoft" e o título "Suporte"
- **Inter** — todo o restante da interface

Para uso offline, baixe os `.woff2` e troque o `<link>` por `@font-face`
em `src/index.css` apontando para `src/assets/fonts/`.

## Preparação para o Supabase

Nada na tela usa o Supabase ainda — a estrutura só está pronta para quando
o projeto existir:

1. Crie o projeto no Supabase.
2. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY`.
3. Gere os tipos do schema, substituindo o placeholder:
   ```bash
   npx supabase gen types typescript --project-id <id> > src/types/supabase.ts
   ```
4. Importe `supabase` de `src/lib/supabaseClient.ts` onde for autenticar
   (`supabase.auth.signInWithPassword(...)`). `supabase` é `null` até as
   variáveis de ambiente existirem — sempre cheque `isSupabaseConfigured`
   ou o valor antes de usar.

## Design

Tokens no `:root` de `src/features/auth/LoginPage.css`:

| Token | Valor | Uso |
|---|---|---|
| `--blue-panel` | `#0B56E4` | fundo dos dois cards |
| `--amber` | `#FFA414` | botões "ENTRAR" e "Abrir" |
| `--yellow` | `#FFD62E` | letras "lit" da logomarca |

O fundo é a foto cinemática do pôr do sol (`tela-de-login-cinematica.webp`) —
mantém as cores originais, só escurece as bordas onde os cards se apoiam.

Composição calibrada para 1388×742 (a referência):

- card de login — `top: 68px`, `right: 26px`, `476px` de largura
- card de suporte — `left: 10px`, `bottom: 16px`, `352px` de largura

Breakpoints:

- **≤ 1180px** — mesma composição, escala reduzida
- **≤ 920px ou altura ≤ 680px** — cards empilhados, login primeiro
- **≤ 480px** — tipografia e alturas de campo reduzidas

## Pontos de integração

- `src/features/auth/LoginForm.tsx` — o `setTimeout` dentro do `handleSubmit`
  marca onde entra a chamada real de autenticação.
- `data-action="recuperar-senha"` e `data-action="ticket"` — âncoras prontas
  para receber as rotas de recuperação de senha e abertura de chamado.

## legacy-static/

Protótipo original em HTML/CSS/JS puro, sem build step. Mantido só como
referência — a tela ativa é a versão React em `src/`.
