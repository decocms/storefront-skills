---
name: vtex-login-headless
description: Diagnose and fix headless login issues on VTEX storefronts — covering authorized domain setup and simulating an authenticated session by copying VtexIdclientAutCookie cookies.
---

## What is VTEX Headless Login

Headless login on VTEX refers to authenticating users outside the VTEX Admin panel — in custom storefronts, external applications, or development environments that consume VTEX APIs with an authenticated session.

---

## Domain restriction

Headless login **only works for domains explicitly authorized** in the VTEX account settings.

### How to authorize a domain

In the VTEX Admin panel, navigate to:

```
Account Settings → Account → Stores → (select store) → Edit → Add Host
```

Add the domain (e.g. `my-store.com`, `localhost:3000`) to the list of allowed hosts. Without this entry, VTEX will block all headless authentication attempts from that origin.

---

## Simulating an authenticated session (for testing)

When it is not practical to run a full login flow in a test environment, you can **copy authentication cookies** from an already-authenticated session.

### Steps

1. Open an authorized domain in the browser and log in normally.
2. Open DevTools and go to the **Application → Cookies** tab.
3. Find all cookies whose name starts with:
   ```
   VtexIdclientAutCookie
   ```
4. Copy those cookie values.
5. In the target environment, inject the same cookies (via DevTools, a cookie-manager extension, or programmatically via `document.cookie`).

### Cookies to look for

| Name | Description |
|---|---|
| `VtexIdclientAutCookie` | Main session authentication cookie |
| `VtexIdclientAutCookie_<accountName>` | Per-account variant (present in multi-store setups) |

> **Note:** these cookies expire. If the authenticated state does not persist, check whether the cookies are still valid at the source.

---

## Quick diagnostics

| Symptom | Likely cause |
|---|---|
| Login keeps redirecting in a loop | Domain is not in the authorized hosts list |
| Copied cookie does not maintain session | Cookie is expired, or the destination domain is not authorized |
| API returns `401` even with cookie present | Account name in the cookie does not match the environment |
