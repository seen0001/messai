# Build MessAi From Scratch

This guide explains how to recreate this project from zero, as if you are building it for the first time.

## 1) What you are building

MessAi is a web app that takes a user prompt and generates a full code project by coordinating four AI roles:

1. **Planner**: turns prompt into a project plan
2. **Coder**: generates each file from the plan
3. **Reviewer**: reviews generated project and suggests improvements
4. **Refiner**: applies improvements and returns polished files

The app then shows the final file tree and lets users download it as a ZIP.

## 2) Tech stack

- **Next.js 16** for app framework and routing
- **React 19** for UI
- **TypeScript** for type safety
- **Tailwind CSS 4** for styling
- **JSZip** to generate downloadable ZIP files
- **ESLint** for linting
- **Ollama** endpoints (one or many machines) for model inference

## 3) Prerequisites

- Node.js 20+ (recommended current LTS)
- npm
- One to four machines running Ollama (LAN or VPN reachable)

## 4) Create the project shell

Create a new Next.js TypeScript app:

```bash
npx create-next-app@latest messai --typescript --eslint --app
cd messai
```

Install runtime dependency:

```bash
npm install jszip
```

Install/update styling stack if needed:

```bash
npm install -D tailwindcss @tailwindcss/postcss
```

## 5) Define environment contract

Create `.env.local.example` with role-specific URLs and models:

```env
ROLE_PLANNER_URL=http://192.168.1.10:11434
ROLE_PLANNER_MODEL=qwen3:1.7b

ROLE_CODER_URL=http://192.168.1.11:11434
ROLE_CODER_MODEL=qwen3:1.7b

ROLE_REVIEWER_URL=http://192.168.1.12:11434
ROLE_REVIEWER_MODEL=qwen3:1.7b

ROLE_REFINER_URL=http://192.168.1.13:11434
ROLE_REFINER_MODEL=qwen3:1.7b
```

Users copy this to `.env.local` and customize.

## 6) Stand up Ollama endpoints

On each machine assigned to a role:

```bash
export OLLAMA_HOST=0.0.0.0:11434
ollama serve
ollama pull qwen3:1.7b
```

If you only have one machine, point all role URLs to the same host.

## 7) Implement app flow (recommended order)

### Step A: Build core UI

Create a page with:
- prompt input
- generate button
- progress/status area
- file tree + file content preview
- download ZIP button

### Step B: Add role clients

Implement a small helper that sends requests to each role endpoint (Planner/Coder/Reviewer/Refiner), using model and URL from environment variables.

### Step C: Implement orchestration pipeline

Run this sequence:

1. Send user prompt to Planner and parse a structured file plan.
2. Loop through planned files and call Coder for each file.
3. Send the assembled draft project to Reviewer.
4. Send draft + review feedback to Refiner per file.
5. Store final files in memory/state for rendering and download.

### Step D: Add ZIP generation

Use JSZip to create a zip archive from final generated files and trigger browser download.

### Step E: Add resilience

Add:
- input validation (empty prompt, bad response formats)
- endpoint/model missing checks
- timeout/error messaging per role
- partial progress updates to UI

## 8) Local development

```bash
# first-time setup
cp .env.local.example .env.local
npm install

# run dev server
npm run dev
```

Open `http://localhost:3000`.

## 9) Production build

```bash
npm run build
npm run start
```

Optional quality checks:

```bash
npm run lint
```

## 10) Suggested folder structure

You can keep everything in `src/app/page.tsx` initially, then split as complexity grows:

- `src/app/page.tsx` - main UI and workflow trigger
- `src/lib/roles.ts` - role request helpers
- `src/lib/pipeline.ts` - planner -> coder -> reviewer -> refiner orchestration
- `src/lib/zip.ts` - JSZip download logic
- `src/types/` - shared plan/file/review types

## 11) Security and networking notes

- Keep Ollama services on trusted networks only.
- Do not expose raw Ollama endpoints publicly without auth and network protection.
- Validate all model output before using it as file content.

## 12) Milestone checklist

- [ ] Next.js app created
- [ ] Environment variables defined and documented
- [ ] Role endpoints reachable
- [ ] Planner output parser working
- [ ] Coder loop generating files
- [ ] Reviewer + Refiner integrated
- [ ] File tree rendered in UI
- [ ] ZIP export working
- [ ] Lint passes
- [ ] Production build starts successfully

---

If you are rebuilding this project, follow sections 4 -> 9 in order and keep the orchestration simple first, then harden error handling.
