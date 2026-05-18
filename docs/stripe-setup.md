# Stripe Connect — Guia de Implementação

Este guia cobre tudo o que tens de fazer **no lado do Stripe** (Dashboard + configuração) para ter o BidRoom a funcionar em produção. Não inclui alterações de código — apenas acções no Stripe Dashboard e variáveis de ambiente.

---

## Índice

1. [Arquitectura de pagamentos](#1-arquitectura-de-pagamentos)
2. [Fase 1 — Configurar test mode (DEV)](#2-fase-1--configurar-test-mode-dev)
3. [Fase 2 — Pedir aprovação para produção](#3-fase-2--pedir-aprovação-para-produção)
4. [Fase 3 — Configurar live mode (PROD)](#4-fase-3--configurar-live-mode-prod)
5. [Fase 4 — Testar antes do go-live](#5-fase-4--testar-antes-do-go-live)
6. [Fase 5 — Go-live](#6-fase-5--go-live)
7. [Variáveis de ambiente — referência completa](#7-variáveis-de-ambiente--referência-completa)
8. [Modelo de comissões e taxas](#8-modelo-de-comissões-e-taxas)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Arquitectura de pagamentos

O BidRoom usa **Stripe Connect com Custom accounts** e **Destination charges**:

```
Buyer                   BidRoom (plataforma)         Seller
  │                            │                        │
  │── paga (item + shipping ───▶│                        │
  │    + Stripe fee)            │                        │
  │                            │── transfer (item×96% ──▶│
  │                            │    + shipping)          │
  │                            │                        │
  │                            │◀─ fica (item×4% fee)   │
```

- **Buyer paga:** preço do item + shipping + taxa Stripe estimada (~2.9% + $0.30)
- **Seller recebe:** 96% do preço do item + shipping (transferência directa para o IBAN do seller via Stripe Connect)
- **BidRoom retém:** 4% do preço do item (platform fee)
- **Stripe retém:** ~2.9% + $0.30 (já cobrado ao buyer como line item separado)

São usados **três produtos Stripe distintos**, cada um com o seu webhook:

| Produto | Webhook endpoint | Para quê |
|---------|-----------------|----------|
| **Connect + Checkout** | `POST /api/connect/webhook` | Confirmação de pagamentos, actualizações de contas de sellers |
| **Payments (top-ups)** | `POST /api/payments/webhook` | Recargas de saldo interno |
| **Identity (KYC)** | `POST /api/kyc/webhook` | Verificação de identidade para listagens ≥ $5,000 |

---

## 2. Fase 1 — Configurar test mode (DEV)

### 2.1 Activar Stripe Connect em test mode

1. Acede a [dashboard.stripe.com](https://dashboard.stripe.com)
2. Garante que **Test mode** está **ON** (botão laranja no canto superior direito)
3. No menu lateral: **Connect → Settings** (ou pesquisa "Connect settings")
4. Em **Platform profile**, preenche:
   - **Platform name:** `BidRoom`
   - **Statement descriptor:** `BIDROOM` (aparece no extracto bancário do buyer)
   - **Website URL:** URL do teu frontend de desenvolvimento (ex: `https://icy-glacier-05c442c0f.3.azurestaticapps.net`)
   - **Privacy policy URL:** URL da tua política de privacidade
   - **Terms of service URL:** URL dos teus termos de serviço
5. Em **Account types**, marca **Custom accounts** ✓
6. Clica **Save**

> ⚠️ Sem este passo, o backend devolve `StripePermissionError` quando qualquer seller tenta configurar a conta de pagamentos.

### 2.2 Obter as API keys de test

1. **Developers → API keys** (com Test mode ON)
2. Copia:
   - **Secret key** (`sk_test_...`) → variável `STRIPE_SECRET_KEY` no backend
   - **Publishable key** (`pk_test_...`) → `APP_CONFIG.STRIPE_PUBLISHABLE_KEY` no `index.html` do frontend DEV

### 2.3 Configurar webhooks de test

Cria **três endpoints** separados (Developers → Webhooks → Add endpoint):

#### Webhook 1 — Connect + Checkout

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-dev>.azurewebsites.net/api/connect/webhook` |
| **Scope** | **Your account** ← importante: não escolher "Connected accounts" |
| **"Listen to events on connected accounts"** | ✅ Activar este checkbox |
| **Events** | `checkout.session.completed`, `account.updated` |

> **Porquê "Your account" e não "Connected accounts"?**
> O SDK Stripe v20.x usa a API v1 clássica. O scope "Connected accounts" no Dashboard moderno mostra eventos da API v2 (nomenclatura diferente). Com scope "Your account" + o checkbox "Listen to events on connected accounts" activado, um único endpoint recebe:
> - `checkout.session.completed` — da tua conta de plataforma (buyer pagou)
> - `account.updated` — da conta do seller (verificação concluída), encaminhado automaticamente pelo Stripe

Após criar: copia o **Signing secret** (`whsec_...`) → variável `STRIPE_CONNECT_WEBHOOK_SECRET`

#### Webhook 2 — Payments (top-ups)

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-dev>.azurewebsites.net/api/payments/webhook` |
| **Events** | `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed` |

Após criar: copia o **Signing secret** → variável `STRIPE_WEBHOOK_SECRET`

#### Webhook 3 — Identity / KYC

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-dev>.azurewebsites.net/api/kyc/webhook` |
| **Events** | `identity.verification_session.verified`, `identity.verification_session.requires_input` |

Após criar: copia o **Signing secret** → variável `STRIPE_IDENTITY_WEBHOOK_SECRET`

> **Alternativa para desenvolvimento local:** usa a [Stripe CLI](https://stripe.com/docs/stripe-cli) para reencaminhar eventos para localhost:
> ```bash
> stripe listen --forward-to localhost:3000/api/connect/webhook
> stripe listen --forward-to localhost:3000/api/payments/webhook
> ```

### 2.4 Testar o fluxo de onboarding em test mode

Para verificar uma conta de seller instantaneamente sem KYC real:

1. Faz login como seller no ambiente de desenvolvimento
2. Dashboard → Settings → **Set up payout account**
3. Preenche o formulário com estes valores mágicos da Stripe:

| Campo | Valor de teste |
|-------|---------------|
| Data de nascimento | `01 / 01 / 1901` ← magic value |
| Morada | Qualquer coisa (ex: `Rua de Exemplo, 1`) |
| Cidade | Qualquer coisa (ex: `Lisboa`) |
| Código postal | Qualquer coisa (ex: `1000-001`) |
| País | Portugal (ou qualquer país suportado) |
| IBAN | `PT50 0002 0123 1234 5678 9015 4` |

O backend detecta automaticamente o test mode (chave `sk_test_`) e aplica `id_number: '000000000'` e `dob.year: 1901` internamente — a conta fica verificada de imediato sem documentos reais.

**Cartões de teste para pagamentos:**

| Número | Comportamento |
|--------|--------------|
| `4242 4242 4242 4242` | Pagamento aprovado |
| `4000 0000 0000 9995` | Cartão recusado (insufficient funds) |
| `4000 0025 0000 3155` | Requer autenticação 3D Secure |

Data de validade: qualquer data futura. CVC: qualquer 3 dígitos.

---

## 3. Fase 2 — Pedir aprovação para produção

> ⏱️ **Este passo pode demorar 1–5 dias úteis. Faz isto primeiro.**

### 3.1 Porquê é necessário

Contas Custom são o tipo mais poderoso de conta Connect — o seller nunca visita o Stripe, tudo é gerido pela plataforma. Por isso a Stripe faz uma revisão manual antes de autorizar a criação de contas Custom em live mode.

### 3.2 Como submeter o pedido

1. **Desactiva** Test mode (botão no canto superior direito fica cinzento/azul)
2. **Connect → Settings**
3. Clica em **Request live access** ou **Apply to go live** (o texto varia)
4. Preenche o questionário:

**Informação que a Stripe vai pedir:**

| Pergunta | O que responder |
|----------|----------------|
| What does your platform do? | Online auction and marketplace platform. Sellers list items for auction or best-offer. Buyers bid and pay. BidRoom facilitates the transaction and manages dispute resolution. |
| What countries do your sellers operate in? | Lista os países onde vais operar (pelo menos Portugal/EU) |
| What is the expected average transaction volume? | Estimativa honesta em USD/mês |
| How do you verify seller identity? | Sellers provide date of birth, address and IBAN. We are integrating Stripe Identity for high-value listings (≥$5,000). |
| Do sellers set their own prices? | Yes |
| Account type needed | Custom |

5. Submete e aguarda email de aprovação.

### 3.3 Enquanto aguardas aprovação

- Continua a testar com `sk_test_` — o test mode não precisa de aprovação
- Prepara todos os outros passos desta fase (platform profile, políticas, etc.)
- Verifica o email diariamente — a Stripe pode pedir informação adicional

---

## 4. Fase 3 — Configurar live mode (PROD)

Só faz estes passos **após receber confirmação de aprovação** da Stripe.

### 4.1 Completar o platform profile em live mode

1. Test mode **OFF**
2. **Connect → Settings → Platform profile**
3. Preenche todos os campos com URLs de produção:
   - **Website URL:** `https://www.bidroom.com` (URL real de produção)
   - **Privacy policy URL:** URL real
   - **Terms of service URL:** URL real
   - **Statement descriptor:** `BIDROOM` (máx. 22 caracteres, sem caracteres especiais)
   - **Support email / phone:** contacto de suporte ao cliente
4. Em **Account types** → confirma que **Custom** está activado
5. **Save**

### 4.2 Obter as API keys de produção

1. Test mode OFF → **Developers → API keys**
2. Copia:
   - **Secret key** (`sk_live_...`) → variável `STRIPE_SECRET_KEY` na App Service de produção
   - **Publishable key** (`pk_live_...`) → `APP_CONFIG.STRIPE_PUBLISHABLE_KEY` no `index.html` de produção

### 4.3 Configurar webhooks de produção

Repete a criação dos três endpoints (secção 2.3) usando os URLs de produção:

#### Webhook 1 — Connect + Checkout

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-prod>.azurewebsites.net/api/connect/webhook` |
| **Scope** | **Your account** |
| **"Listen to events on connected accounts"** | ✅ Activar |
| **Events** | `checkout.session.completed`, `account.updated` |

→ `STRIPE_CONNECT_WEBHOOK_SECRET` (prod)

#### Webhook 2 — Payments

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-prod>.azurewebsites.net/api/payments/webhook` |
| **Events** | `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed` |

→ `STRIPE_WEBHOOK_SECRET` (prod)

#### Webhook 3 — Identity / KYC

| Campo | Valor |
|-------|-------|
| **Endpoint URL** | `https://<backend-prod>.azurewebsites.net/api/kyc/webhook` |
| **Events** | `identity.verification_session.verified`, `identity.verification_session.requires_input` |

→ `STRIPE_IDENTITY_WEBHOOK_SECRET` (prod)

### 4.4 O que acontece com a verificação de sellers em produção

Ao contrário do test mode, em produção a Stripe **não verifica as contas instantaneamente**. Após o seller submeter o formulário de onboarding:

1. A conta é criada com `details_submitted: true`
2. A Stripe analisa os dados (pode ser imediato para casos simples, ou demorar horas/dias se pedir documentos adicionais)
3. Quando a verificação termina, a Stripe envia o evento `account.updated`
4. O backend processa o evento, actualiza `stripeConnectOnboarded`, e envia email ao seller

**O que a Stripe pode pedir ao seller (via email automático):**
- Número de identificação fiscal (NIF em Portugal, SSN nos EUA, etc.)
- Foto de documento de identidade
- Extracto bancário

> O seller verá o estado "Payouts pending" até a Stripe completar a verificação. Garante que a UI reflecte este estado (o endpoint `GET /api/connect/account-status` devolve `onboarded: false, chargesEnabled: false` durante este período).

---

## 5. Fase 4 — Testar antes do go-live

**Nunca mudes directamente de `sk_test_` para `sk_live_` sem testar.**

### 5.1 Teste de ponta a ponta em produção com chaves de test

1. Configura o servidor de produção temporariamente com `sk_test_` e os webhook secrets de test
2. Regista os webhooks de test a apontar para os URLs de produção (podes ter endpoints test e live em simultâneo no Dashboard)
3. Executa este checklist:

```
[ ] Seller completa onboarding com dados de teste → conta verifica
[ ] Webhook account.updated é recebido e processado (verificar logs do backend)
[ ] Seller consegue criar listagem
[ ] Buyer ganha leilão → transacção criada com status pending_payment
[ ] Buyer completa checkout com cartão 4242 4242 4242 4242
[ ] Webhook checkout.session.completed é recebido e processa transação
[ ] Transacção passa a awaiting_seller_acceptance
[ ] Email enviado ao seller ("Payment received")
[ ] Seller marca como shipped, buyer confirma entrega
[ ] Transacção completa
[ ] Verificar no Stripe Dashboard → Payments que o charge existe
[ ] Verificar no Stripe Dashboard → Connect → Accounts que o transfer existe
[ ] Reembolso automático: criar transação, deixar o prazo de envio expirar (ou simular via scheduler), verificar refund no Dashboard
```

### 5.2 Verificar os webhooks no Dashboard

**Developers → Webhooks → [endpoint] → Webhook attempts**

Cada evento deve mostrar HTTP 200. Se mostrar erros:
- `400` — o body do evento não passou verificação de assinatura (secret errado)
- `404` / `502` — o backend não está acessível ou a rota não existe
- `500` — erro no handler — ver logs do backend

---

## 6. Fase 5 — Go-live

### 6.1 Troca de chaves

No Azure App Service de produção, actualiza:

| Variável | Novo valor |
|----------|-----------|
| `STRIPE_SECRET_KEY` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (live, do webhook de payments) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` (live, do webhook de connect) |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | `whsec_...` (live, do webhook de KYC) |

No `index.html` do frontend de produção:
```html
<script>
  window.APP_CONFIG = {
    API_URL: "https://<backend-prod>.azurewebsites.net/api",
    STRIPE_PUBLISHABLE_KEY: "pk_live_..."
  };
</script>
```

### 6.2 Confirma que estas variáveis NÃO estão definidas em produção

| Variável | Porquê não pode existir em prod |
|----------|--------------------------------|
| `SKIP_STRIPE_VALIDATION` | Bypassa completamente a verificação de conta Connect — qualquer seller pode criar listagens sem ter conta de pagamentos |

### 6.3 Transacção real de validação

Após trocar para live mode, faz uma transacção real de valor baixo (ex: $1–5) entre duas contas reais tuas para confirmar que o fluxo completo funciona com dinheiro real.

Verifica no Stripe Dashboard:
- **Payments** → o charge existe e está `Succeeded`
- **Connect → Transfers** → o transfer para a conta do seller existe
- **Connect → Accounts** → a conta do seller tem `Charges enabled: Yes`

---

## 7. Variáveis de ambiente — referência completa

| Variável | DEV (test mode) | PROD (live mode) | Obrigatória |
|----------|-----------------|------------------|-------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` | ✅ Sim |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) | ✅ Sim |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) | ✅ Sim (sem isto os webhooks não verificam a assinatura) |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | `whsec_...` (test) | `whsec_...` (live) | Se usares KYC |
| `SKIP_STRIPE_VALIDATION` | Não usar | **Nunca** | ❌ Não definir |

**Frontend (via `APP_CONFIG` em `index.html`):**

| Variável | DEV | PROD |
|----------|-----|------|
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` | `pk_live_...` |

---

## 8. Modelo de comissões e taxas

Documentado aqui para referência ao configurar e auditar os pagamentos no Dashboard.

### Para uma venda de $100 (sem shipping)

| Parte | Montante | Origem |
|-------|----------|--------|
| Buyer paga | ~$103.20 | $100 item + $3.20 taxa Stripe estimada |
| Seller recebe | $96.00 | $100 − 4% BidRoom fee |
| BidRoom retém | $4.00 | 4% platform fee |
| Stripe retém | ~$3.20 | ~2.9% + $0.30 (pago pelo buyer) |

> A taxa Stripe é uma **estimativa** calculada no momento do checkout. A diferença de centavos face ao valor real é absorvida pela plataforma.

### O que ver no Stripe Dashboard por transacção

1. **Payments** → encontra o charge pelo valor → expande → vês o `transfer` associado
2. **Connect → Transfers** → vês a transferência para a conta do seller com o montante exacto
3. **Balance** → vês o saldo da plataforma (acumulação das fees de 4%)

---

## 9. Troubleshooting

| Erro / Sintoma | Causa provável | Solução |
|----------------|----------------|---------|
| `Payout account setup is temporarily unavailable` | Connect não activado ou plataforma não aprovada | Faz os passos 2.1 e 3 |
| `Payments not configured` | `STRIPE_SECRET_KEY` não definido | Adicionar env var na App Service |
| Webhook mostra HTTP 400 | Signing secret errado | Re-copiar o `whsec_...` do endpoint no Dashboard |
| Seller fica com `onboarded: false` após submeter | Stripe pediu documentos adicionais | Verificar email do seller; ver `requirementErrors` em `GET /api/connect/account-status` |
| Transfer não aparece no Dashboard | Conta do seller não tem `transfers` capability activa | Aguardar verificação completa; em test mode usa os magic values |
| `StripeInvalidRequestError: No such account` | `stripeConnectAccountId` na DB aponta para uma conta que não existe (ex: conta de test usada em prod) | Limpar `stripeConnectAccountId` e `stripeConnectOnboarded` do User na DB |
| Refund automático falha | Transfer já foi pago ao seller e a conta não tem saldo suficiente | Processo manual via Dashboard → Payments → [charge] → Refund; ou contactar o seller |
| `StripePermissionError` em live mode | Aprovação ainda pendente | Aguardar email de aprovação da Stripe; verificar status em Connect → Settings |
| Buyer vê "Seller not ready" no checkout | Seller não tem conta Connect configurada | Seller deve completar o onboarding em Settings → Payout account |

---

## Checklist de go-live (resumo)

```
Stripe Dashboard — Test mode
[ ] Connect activado com Custom accounts em test mode
[ ] 3 webhooks criados (connect, payments, kyc) com URLs de DEV
[ ] Fluxo de ponta a ponta testado com cartões e IBANs de teste

Stripe Dashboard — Aprovação produção
[ ] Pedido de aprovação para live mode submetido
[ ] Aprovação recebida por email

Stripe Dashboard — Live mode
[ ] Platform profile completo com URLs de produção
[ ] 3 webhooks criados com URLs de PROD
[ ] API keys live copiadas

Backend de produção (Azure App Service)
[ ] STRIPE_SECRET_KEY = sk_live_...
[ ] STRIPE_WEBHOOK_SECRET = whsec_... (live)
[ ] STRIPE_CONNECT_WEBHOOK_SECRET = whsec_... (live)
[ ] STRIPE_IDENTITY_WEBHOOK_SECRET = whsec_... (live)
[ ] SKIP_STRIPE_VALIDATION não está definido

Frontend de produção (index.html)
[ ] STRIPE_PUBLISHABLE_KEY = pk_live_...

Validação final
[ ] Transacção real de teste ($1–5) completa com sucesso
[ ] Transfer aparece no Stripe Dashboard
[ ] Email de "Payment received" chega ao seller
```
