# Stripe Connect — o que falta fazer do teu lado

**Actualizado a 24/09/2026, depois de teres passado produção para live mode.**
Seguimento do ticket de suporte do José Luís. O guia geral está em
[stripe-setup.md](stripe-setup.md); aqui está apenas o que está partido **agora**.

---

## Estado actual

Produção (`bidroom-backend-prod`, grupo `EriceiraQA`):

| Definição | Valor | |
|---|---|---|
| `STRIPE_MODE` | `live` | ✅ |
| `STRIPE_SECRET_KEY_LIVE` | `sk_live_51TI…` → `acct_1TI5X806hw2O8NlN` (PT, EUR) | ✅ chave válida, charges e payouts ativos |
| `STRIPE_SECRET_KEY` | `sk_test_51Sx…` | ⚠️ chave **de outra conta**, já não usada |
| `STRIPE_WEBHOOK_SECRET` e os dois `CONNECT` | inalterados desde antes da mudança | ⚠️ ver passo 2 |
| Contas Connect ligadas em live | 0 | — |

Escolheste a conta `51TI…` como a verdadeira, e é a mesma que o dev e o `.env` local usam em
test mode. Isso está coerente.

---

## O erro "Invalid IP address" — resolvido no código

Apareceu **por causa** da mudança para live mode, e não por acaso.

O `getClientIp` do `connect.js` tinha um atalho: em modo test devolvia `127.0.0.1` sem procurar
nada. Enquanto produção corria com chave de teste, esse atalho aplicava-se e escondia o bug. Ao
passares para live, a deteção real entrou em ação pela primeira vez em produção — e essa deteção
estava errada.

O Azure App Service escreve a **porta do cliente** no `X-Forwarded-For` (`85.240.12.34:57321`). O
helper não a removia e, pior, aceitava o resultado como endereço IPv6 só porque tinha dois pontos.
Esse texto seguia para a Stripe como `tos_acceptance.ip`, e a Stripe respondia *"Invalid IP
address"* — que o vendedor lê como estando errado o que ele escreveu.

Confirmei contra a API da Stripe: das cinco formas testadas, a versão com porta é a **única**
rejeitada. Endereço simples, `::ffff:…`, `127.0.0.1` e ausência de `ip` passam todas.

Correção no commit `4632896`:

- A lógica passou para [backend/src/utils/clientIp.js](../backend/src/utils/clientIp.js), com 17 testes.
- Havia **três cópias** desta lógica no backend, cada uma errada de maneira diferente; o registo de
  fraude e o limitador de licitações também guardavam portas e prefixos `::ffff:`. Agora usam a mesma.
- `tos_acceptance.ip` é **omitido** em vez de enviado vazio quando o proxy não revela o cliente — a
  Stripe aceita a aceitação só com data.
- O atalho `127.0.0.1` passou a depender de `NODE_ENV`, não do modo Stripe.

**Falta o deploy.** Sem ele, o erro mantém-se.

---

## O que falta fazer

### Passo 1 — deploy do commit `4632896`

É código, não configuração. Sem deploy, nenhum vendedor passa do formulário.

### Passo 2 — webhook secrets (provavelmente inválidos) ⚠️

Os três `whsec_…` em produção não mudaram desde que a app corria em **test mode na conta `51Sx…`**.
Um webhook secret pertence a um endpoint, e um endpoint pertence a uma conta **e** a um modo. Se
não os regeraste, os eventos live da conta `51TI…` vão falhar todos na verificação de assinatura.

O sintoma é silencioso e caro: o comprador paga, a Stripe manda o evento, o backend rejeita-o por
assinatura inválida, e a encomenda nunca é confirmada.

Em https://dashboard.stripe.com/webhooks (**em live mode, na conta `51TI…`**), confirma que existem
os três endpoints e copia os secrets novos:

| Endpoint | Variável |
|---|---|
| `/api/payments/webhook` | `STRIPE_WEBHOOK_SECRET` |
| `/api/connect/webhook` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `/api/connect/webhook` (eventos de conta ligada) | `STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET` |

As rotas estão em [backend/src/index.js:224-226](../backend/src/index.js#L224-L226). O host é
`https://bidroom-backend-prod-e9eghtc0aha4e3dw.uksouth-01.azurewebsites.net`.

### Passo 3 — Connect e Platform profile **em live mode**

Ativar Connect em test **não** ativa em live, e o Platform profile é preenchido por modo. Na conta
`51TI…`, em live:

- https://dashboard.stripe.com/connect — Connect ativo
- https://dashboard.stripe.com/settings/connect/platform-profile — perfil preenchido

As perguntas são sobre a **BidRoom**, não sobre o vendedor: marketplace, quem recolhe os requisitos
(**a plataforma**), quem suporta perdas (**a plataforma**), site `https://bidroom.pt`.

Não consegui verificar isto por ti sem criar uma conta Connect **real** na tua plataforma live —
diz se queres que o faça (crio e apago logo a seguir).

### Passo 4 — limpar a chave morta

`STRIPE_SECRET_KEY` em produção ainda tem `sk_test_51Sx…`, de uma conta que já não usas. Não faz mal
enquanto `STRIPE_MODE=live`, mas é uma armadilha: qualquer mudança ou remoção de `STRIPE_MODE` faz a
app cair silenciosamente nessa conta errada
([stripe.util.js](../backend/src/utils/stripe.util.js)).

```bash
az webapp config appsettings delete -g EriceiraQA -n bidroom-backend-prod \
  --setting-names STRIPE_SECRET_KEY
az webapp restart -g EriceiraQA -n bidroom-backend-prod
```

### Passo 5 — webhook secret em dev e local

`STRIPE_WEBHOOK_SECRET` está **vazio** no backend de dev (`bidroom-dev-rg`) e **ausente** no
`backend/.env`. Para o local:

```bash
stripe listen --forward-to localhost:3000/api/payments/webhook   # -> STRIPE_WEBHOOK_SECRET
stripe listen --forward-to localhost:3000/api/connect/webhook    # -> STRIPE_CONNECT_WEBHOOK_SECRET
```

### Passo 6 — responder ao ticket

Continua em **AGUARDA RESPOSTA**. Depois dos passos 1 a 3:

> Olá José Luís, obrigado pelo reporte — o erro era nosso, não dos seus dados. Havia uma configuração
> em falta do nosso lado na ligação ao Stripe, já corrigida. Não precisa de criar conta de plataforma
> no Stripe nem de indicar site de loja: basta voltar ao formulário de recebimentos na sua área de
> vendedor e preencher data de nascimento, morada e IBAN. Se voltar a falhar, diga-nos.

---

## Como diagnosticar o próximo erro sem adivinhar

Em produção a mensagem que o vendedor vê é deliberadamente vaga, e o detalhe da Stripe vai só para
os logs. Para o ler enquanto testas:

```bash
az webapp log tail -g EriceiraQA -n bidroom-backend-prod | grep -i connect
```

As linhas úteis têm o prefixo `[connect]` e incluem `type=` e a mensagem original da Stripe.

---

## Para testar localmente

O backend do BidRoom não estava a correr nesta máquina — a porta 3000 está ocupada desde 23/09 por
um `next-server` de outro projeto, e por isso os testes no browser estavam a bater em produção.

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN     # ver quem está na porta
cd backend && npm run dev
cd frontend && npx ng serve           # proxy.conf.local.json -> localhost:3000
```

`npx ng serve --configuration development-azure` aponta para o backend de dev no Azure. Um build de
`ericeira-prod` ou `ericeira-e2e` fala **diretamente com produção** — se um teste local mostrar
dados reais, é isso que estás a correr.

---

## Resumo

| # | Acção | Onde | Bloqueia |
|---|---|---|---|
| 1 | Deploy do `4632896` | CI | o formulário de recebimentos |
| 2 | Regerar webhook secrets em live | Stripe + Azure | confirmação de pagamentos |
| 3 | Connect + Platform profile em live | Stripe | o formulário de recebimentos |
| 4 | Apagar `STRIPE_SECRET_KEY` morta | Azure | — (armadilha futura) |
| 5 | Webhook secret em dev/local | Azure + `.env` | testes locais |
| 6 | Responder ao ticket | Nexus | — |

Os passos 1 e 3 são os que desbloqueiam o vendedor. O passo 2 é o que evita o próximo incidente.
