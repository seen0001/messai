/**
 * Each role runs on its own computer/IP. Configure via env.
 * Example: ROLE_PLANNER_URL=http://192.168.1.10:11434
 */

export type RoleId = "planner" | "coder" | "reviewer" | "refiner";

export interface RoleConfig {
  id: RoleId;
  name: string;
  description: string;
  urlEnv: string;
  modelEnv: string;
}

export const ROLES: RoleConfig[] = [
  {
    id: "planner",
    name: "Planner",
    description: "Breaks down the prompt into a structured project plan (files, steps).",
    urlEnv: "ROLE_PLANNER_URL",
    modelEnv: "ROLE_PLANNER_MODEL",
  },
  {
    id: "coder",
    name: "Coder",
    description: "Generates code for each file from the plan.",
    urlEnv: "ROLE_CODER_URL",
    modelEnv: "ROLE_CODER_MODEL",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description: "Reviews the full project and suggests improvements.",
    urlEnv: "ROLE_REVIEWER_URL",
    modelEnv: "ROLE_REVIEWER_MODEL",
  },
  {
    id: "refiner",
    name: "Refiner",
    description: "Applies the review and produces final, polished file content.",
    urlEnv: "ROLE_REFINER_URL",
    modelEnv: "ROLE_REFINER_MODEL",
  },
];

export type RoleOverrides = Partial<Record<RoleId, { url?: string; model?: string }>>;

const OLLAMA_DEFAULT_PORT = "11434";

/** Ensures URL has a scheme and Ollama port (11434) when no port is given. */
function normalizeOllamaUrl(url: string): string {
  const u = url.replace(/\/$/, "").trim();
  if (!u) return `http://localhost:${OLLAMA_DEFAULT_PORT}`;
  let href = u;
  if (!/^https?:\/\//i.test(href)) href = `http://${href}`;
  try {
    const parsed = new URL(href);
    if (!parsed.port) parsed.port = OLLAMA_DEFAULT_PORT;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return u.includes(":") ? u : `http://${u}:${OLLAMA_DEFAULT_PORT}`;
  }
}

export function getRoleUrl(roleId: RoleId, overrides?: RoleOverrides): string {
  const o = overrides?.[roleId]?.url?.trim();
  if (o) return normalizeOllamaUrl(o);
  const role = ROLES.find((r) => r.id === roleId);
  if (!role) return "http://localhost:11434";
  const url = process.env[role.urlEnv] || process.env.OLLAMA_URL || "http://localhost:11434";
  return normalizeOllamaUrl(url);
}

export function getRoleModel(roleId: RoleId, overrides?: RoleOverrides): string {
  const o = overrides?.[roleId]?.model?.trim();
  if (o) return o;
  const role = ROLES.find((r) => r.id === roleId);
  if (!role) return "qwen3:1.7b";
  return process.env[role.modelEnv] || process.env.OLLAMA_MODEL || "qwen3:1.7b";
}

export function getRoleConfigForClient(): { id: RoleId; name: string; description: string; url: string; model: string }[] {
  return ROLES.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    url: getRoleUrl(r.id),
    model: getRoleModel(r.id),
  }));
}
