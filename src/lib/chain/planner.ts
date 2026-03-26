import { callOllama, callOllamaWithTools } from "../ollama";
import { getRoleUrl, getRoleModel, type RoleOverrides } from "../roles";
import type { ChainProgressEvent } from ".";

const PLANNER_SYSTEM = `You are a project planner. Given a user's request for a software project, you must call the tool \`emit_project_plan\` with a structured plan.

Rules:
- You MUST call the tool \`emit_project_plan\`.
- Do not output any other text.
- If the tool is somehow unavailable, fall back to outputting ONLY the JSON object described in the function parameters.

- Use realistic paths: src/..., package.json, README.md, etc.
- Include all files needed for the project (entry point, config, components).
- path must be relative, use forward slashes.
- Output only the JSON object, nothing else.`;

const PLANNER_SYSTEM_LEGACY = `You are a project planner. Given a user's request for a software project, you output a structured plan as JSON only, no other text.

Output exactly this JSON structure (no markdown, no code fence):
{
  "projectName": "short-folder-name",
  "description": "one line",
  "files": [
    { "path": "relative/path/to/file.ext", "purpose": "what this file does" }
  ]
}

Rules:
- Use realistic paths: src/..., package.json, README.md, etc.
- Include all files needed for the project (entry point, config, components).
- path must be relative, use forward slashes.
- Output only the JSON object, nothing else.`;

export interface PlannedFile {
  path: string;
  purpose: string;
}

export interface ProjectPlan {
  projectName: string;
  description: string;
  files: PlannedFile[];
}

function truncateText(s: string, max = 1200): string {
  const t = (s ?? "").toString();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function runPlanner(
  userPrompt: string,
  overrides?: RoleOverrides,
  onProgress?: (event: ChainProgressEvent) => void
): Promise<ProjectPlan> {
  const url = getRoleUrl("planner", overrides);
  const model = getRoleModel("planner", overrides);

  const toolName = "emit_project_plan";
  const tools = [
    {
      type: "function",
      function: {
        name: toolName,
        description: "Emit the structured project plan for the requested software project.",
        parameters: {
          type: "object",
          required: ["projectName", "description", "files"],
          properties: {
            projectName: { type: "string" },
            description: { type: "string" },
            files: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "purpose"],
                properties: {
                  path: { type: "string" },
                  purpose: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  ];

  onProgress?.({
    kind: "llm_call",
    stage: "planner",
    url,
    model,
    systemPromptPreview: truncateText(PLANNER_SYSTEM),
    userMessagePreview: truncateText(userPrompt),
  });

  const resp = await callOllamaWithTools(
    url,
    model,
    [{ role: "user", content: userPrompt }],
    PLANNER_SYSTEM,
    tools
  );

  const contentFull = resp?.message?.content ?? "";
  const toolCalls = resp?.message?.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const call = toolCalls[0];
    let args: unknown = call.function.arguments as unknown;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args) as unknown;
      } catch {
        // Keep original string for preview.
      }
    }
    onProgress?.({
      kind: "tool_call",
      stage: "planner",
      toolName,
      argumentsPreview: truncateText(JSON.stringify(args), 2000),
    });

    const parsed = args as Partial<ProjectPlan> | undefined;
    const files = parsed?.files;

    if (typeof parsed?.projectName !== "string" || !Array.isArray(files)) {
      const preview = truncateText(
        JSON.stringify({ projectName: parsed?.projectName, files: files?.slice?.(0, 3) }),
        2000
      );
      throw new Error(`Planner tool args invalid: ${preview}`);
    }

    return {
      projectName: parsed.projectName.trim() || "project",
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      files: files.map((f: unknown) => {
        const item = f as { path?: unknown; purpose?: unknown };
        return {
          path: String(item.path || "file.txt").trim(),
          purpose: String(item.purpose || "").trim(),
        };
      }),
    };
  }

  const contentPreview = truncateText(contentFull, 800);
  onProgress?.({ kind: "llm_result", stage: "planner", contentPreview });

  // Retry without tools if tool-calling was not honored AND content is empty.
  if (!contentFull || contentFull.trim().length === 0) {
    onProgress?.({
      kind: "llm_call",
      stage: "planner",
      url,
      model,
      systemPromptPreview: truncateText(PLANNER_SYSTEM_LEGACY),
      userMessagePreview: truncateText(userPrompt),
    });

    const legacy = await callOllama(
      url,
      model,
      [{ role: "user", content: userPrompt }],
      PLANNER_SYSTEM_LEGACY
    );

    const legacyPreview = truncateText(legacy ?? "", 800);
    onProgress?.({ kind: "llm_result", stage: "planner", contentPreview: legacyPreview });

    const legacyJsonMatch = legacy.match(/\{[\s\S]*\}/);
    if (!legacyJsonMatch) {
      throw new Error(`Planner legacy retry returned non-JSON content: ${legacyPreview}`);
    }

    try {
      const parsed = JSON.parse(legacyJsonMatch[0]) as ProjectPlan;
      if (!parsed.files || !Array.isArray(parsed.files)) {
        throw new Error("Invalid plan: missing or invalid files array");
      }
      return {
        projectName: typeof parsed.projectName === "string" ? parsed.projectName.trim() : "project",
        description: typeof parsed.description === "string" ? parsed.description.trim() : "",
        files: parsed.files.map((f: { path?: string; purpose?: string }) => ({
          path: String(f.path || "file.txt").trim(),
          purpose: String(f.purpose || "").trim(),
        })),
      };
    } catch (e) {
      throw new Error(
        `Planner legacy retry failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // If content isn't empty but also tool-calls missing, attempt JSON parse from content.
  const jsonMatch = contentFull.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Planner returned non-JSON content: ${contentPreview}`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ProjectPlan;
    if (!parsed.files || !Array.isArray(parsed.files)) {
      throw new Error("Invalid plan: missing or invalid files array");
    }
    return {
      projectName: typeof parsed.projectName === "string" ? parsed.projectName.trim() : "project",
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      files: parsed.files.map((f: { path?: string; purpose?: string }) => ({
        path: String(f.path || "file.txt").trim(),
        purpose: String(f.purpose || "").trim(),
      })),
    };
  } catch (e) {
    throw new Error(
      `Planner did not return valid tool args or JSON: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
