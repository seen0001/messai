# MessAi

Generate coded projects from a single prompt. Each AI role in the chain runs on **its own computer** (different IP).

## How it works (4 computers)

1. **Planner** (computer 1): Takes your prompt and outputs a structured plan (project name, list of files with purposes).
2. **Coder** (computer 2): For each file in the plan, generates the full file content.
3. **Reviewer** (computer 3): Reviews the full project and suggests improvements.
4. **Refiner** (computer 4): For each file, applies the review and outputs final, polished content.

You get a full project: file tree + contents, and can **download as ZIP**.

## Setup

### 1. Run Ollama on each computer

On **each** machine that will host a role:

```bash
# Expose Ollama on the network (not just localhost)
export OLLAMA_HOST=0.0.0.0:11434
ollama serve
# Pull a model, e.g. ollama pull qwen3:1.7b
```

Note each machine’s IP (e.g. `192.168.1.10`, `192.168.1.11`).

### 2. Configure MessAi (this app)

Copy env example and set **one URL per role**:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with one URL per computer:

```
ROLE_PLANNER_URL=http://192.168.1.10:11434
ROLE_PLANNER_MODEL=qwen3:1.7b

ROLE_CODER_URL=http://192.168.1.11:11434
ROLE_CODER_MODEL=qwen3:1.7b

ROLE_REVIEWER_URL=http://192.168.1.12:11434
ROLE_REVIEWER_MODEL=qwen3:1.7b

ROLE_REFINER_URL=http://192.168.1.13:11434
ROLE_REFINER_MODEL=qwen3:1.7b
```

If you have fewer than 4 machines, point multiple roles at the same URL (e.g. all to `http://localhost:11434`).

### 3. Run MessAi

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a prompt (e.g. “A React todo app with Tailwind”), click **Generate project**, then **Download ZIP**.

## Roles

| Role     | Env URL             | Responsibility                            |
| -------- | ------------------- | ----------------------------------------- |
| Planner  | `ROLE_PLANNER_URL`  | Turn prompt → JSON plan (files, steps)    |
| Coder    | `ROLE_CODER_URL`    | Generate code for each file               |
| Reviewer | `ROLE_REVIEWER_URL` | Review full project, suggest improvements |
| Refiner  | `ROLE_REFINER_URL`  | Apply review, output final file content   |

Each URL = one computer. Use 4 machines or point multiple roles at the same IP.

## Security

Good idea to use on a trusted network (e.g. home LAN or VPN). Best not to expose Ollama or MessAi directly to the internet without proper security.
