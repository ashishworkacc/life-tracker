# Contributing to LifeTracker

Thank you for your interest in contributing. This is a personal project, but pull requests that improve the architecture, fix bugs, or add genuinely useful general-purpose features are welcome.

---

## Development Environment Setup

### Prerequisites

- Node.js 20+
- npm 10+
- A Firebase project with Firestore + Auth enabled (see README)
- Git

### 1. Fork & Clone

```bash
git clone https://github.com/your-username/life-tracker.git
cd life-tracker
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
# Fill in all values — a Firebase project is required for the app to function
```

### 3. Run Dev Server

```bash
npm run dev
# App runs at http://localhost:3000
```

### 4. TypeScript Check

```bash
npx tsc --noEmit
```

This must pass with **zero errors** before submitting a PR.

### 5. Build Check

```bash
npm run build
```

A clean production build is required. The CI equivalent is `vercel build`.

---

## Coding Conventions

- **TypeScript everywhere** — no `any` unless genuinely unavoidable; document why if used.
- **Firebase lazy init** — never call `getAuth()` or `getFirestore()` at module level; always use the getter functions in `lib/firebase/config.ts`.
- **No secrets in source** — all credentials go in `.env.local`. If you add a new secret, add a blank entry to `.env.example` with a comment.
- **CSS via Tailwind + CSS vars** — avoid inline `style` objects for colours; use the existing CSS custom properties (`--color-primary`, `--surface`, `--border`, etc.).
- **Firestore writes** — include `userId` on every document and keep `firestore.rules` in sync.

---

## Submitting a Pull Request

1. **Branch from `main`:**
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Keep PRs focused** — one logical change per PR. Large refactors should be discussed in an Issue first.

3. **No secrets** — run `git diff HEAD` and verify no `.env` values, tokens, or personal identifiers are included.

4. **Commit message format:**
   ```
   type: short description (50 chars max)

   Optional longer explanation. Reference issue numbers: Fixes #42
   ```
   Types: `feat`, `fix`, `refactor`, `docs`, `chore`

5. **Open the PR** against `main`. Fill in the template and link any related Issues.

---

## Reporting Bugs

Use the [Bug Report](./.github/ISSUE_TEMPLATE/bug_report.md) template. Include reproduction steps, expected vs actual behaviour, and your browser/OS.

## Suggesting Features

Use the [Feature Request](./.github/ISSUE_TEMPLATE/feature_request.md) template. Explain the problem you're trying to solve before proposing a solution.

## Security Vulnerabilities

**Do not open a public Issue.** See [SECURITY.md](./SECURITY.md) for responsible disclosure instructions.
