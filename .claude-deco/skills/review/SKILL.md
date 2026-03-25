---
name: review
description: Reviews staged changes before publish, checking for hardcoded content, CSS issues, unused files, and security concerns.
---

Review all changes before publishing.

Use git_status and git_diff tools to identify what changed, then review each file against the checklist below.

## Checklist

### 1 - Hardcoded Text/Content
- All user-facing text and content must be editable via properties or configuration.
- Flag any strings that should be dynamic but are written directly in the code.

### 2 - Hardcoded CSS
- Use Tailwind tokens (spacing, colors, typography, etc.) instead of raw CSS values.
- Flag any inline styles or arbitrary values that have a Tailwind equivalent.

### 3 - Unused Components/Files
- Verify every newly created or modified file is actually imported and used.
- Flag dead code, unused imports, and orphaned files.

### 4 - Security Issues
- Check for exposed tokens, API keys, secrets, or credentials in code and config files.
- Flag any sensitive data that should be stored in environment variables or a secrets manager.

### 5 - Loaders
- Check if created loaders are being cached properly.
- Flag loaders missing error handling or fallback responses.
- Flag loaders making unnecessary or redundant requests.

### 6 - Sections
- Check if every created section exports a `LoadingFallback` component for skeleton/placeholder rendering.
- Ensure section props are properly typed.

### 7 - Breaking Changes
- Check if changes to shared components, props, or loaders could break other pages or sections that depend on them.
- Flag renamed or removed exports, changed prop signatures, or altered loader response shapes.
- Verify that existing page configurations remain compatible with the updated code.