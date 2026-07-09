# SKILL: VTEX Headless Login

## O que é

Login headless na VTEX refere-se à autenticação de usuários em contextos fora do painel administrativo da VTEX, como em storefronts customizados, aplicações externas ou ambientes de desenvolvimento que consomem as APIs da VTEX com sessão autenticada.

---

## Restrição de domínio

O login headless **só funciona para domínios explicitamente autorizados** na configuração da conta VTEX.

### Como autorizar um domínio

No painel administrativo da VTEX, navegue até:

```
Configurações da Conta → Conta → Stores → (selecione a loja) → Edit → Add Host
```

Adicione o domínio (ex.: `minha-loja.com.br`, `localhost:3000`) na lista de hosts permitidos. Sem esse registro, tentativas de autenticação headless serão bloqueadas pela VTEX.

---

## Simulando um estado logado (para testes)

Quando não é possível (ou prático) realizar o fluxo de login completo no ambiente de teste, é possível **copiar cookies de autenticação** de uma sessão já autenticada.

### Passos

1. Acesse um domínio já autorizado e faça login normalmente.
2. No DevTools do navegador, abra a aba **Application → Cookies**.
3. Localize todos os cookies cujo nome começa com:
   ```
   VtexIdclientAutCookie
   ```
4. Copie os valores desses cookies.
5. No ambiente a ser testado, injete os mesmos cookies (via DevTools, extensão de gerenciamento de cookies, ou programaticamente via `document.cookie`).

### Exemplo de cookies a observar

| Nome | Descrição |
|---|---|
| `VtexIdclientAutCookie` | Cookie principal de autenticação da sessão |
| `VtexIdclientAutCookie_<accountName>` | Variante por conta (presente em ambientes multi-store) |

> **Atenção:** esses cookies têm expiração. Se o estado logado não persistir, verifique se os cookies ainda são válidos na origem.

---

## Diagnóstico rápido

| Sintoma | Causa provável |
|---|---|
| Login redireciona em loop | Domínio não está na lista de hosts autorizados |
| Cookie copiado não mantém sessão | Cookie expirado ou domínio de destino não autorizado |
| API retorna `401` mesmo com cookie | Nome da conta no cookie não corresponde ao ambiente |

---

## Referências

- [VTEX - Configurações de Conta](https://help.vtex.com/pt/tutorial/informacoes-gerais-da-conta--tutorials_190)
- [VTEX ID - Autenticação headless](https://developers.vtex.com/docs/guides/login-integration-guide-headless-flow-from-custom-oauth-provider)
