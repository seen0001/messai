import { callOllamaWithTools } from "../ollama";
import { getRoleUrl, getRoleModel, type RoleOverrides } from "../roles";
import type { ProjectPlan } from "./planner";
import type { ChainProgressEvent } from ".";

const REVIEWER_SYSTEM = `You are a code reviewer. You receive a full software project (list of files with their content) and must call the tool \`emit_review\`.

Rules:
- You MUST call \`emit_review\`.
- Do not output any other text.
- If the tool is somehow unavailable, fall back to outputting the review as a single block of text (no JSON, no markdown headers).

Include:
- Overall quality and consistency
- Bugs, missing error handling, or bad practices
- Suggestions for improvement per file or globally
- Keep it under 400 words so the refiner can use it.`;

export async function runReviewer(
  userPrompt: string,
  plan: ProjectPlan,
  files: { path: string; content: string }[],
  overrides?: RoleOverrides,
  onProgress?: (event: ChainProgressEvent) => void
): Promise<string> {
  const url = getRoleUrl("reviewer", overrides);
  const model = getRoleModel("reviewer", overrides);

  const projectDump = files
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const userMessage = `User request: ${userPrompt}

Project: ${plan.projectName}
${plan.description ? `Description: ${plan.description}` : ""}

Files (${files.length}):
${projectDump}

Review the project and output your critique as a single block of text (under 400 words).`;

  function truncateText(s: string, max = 1800): string {
    const t = (s ?? "").toString();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  const toolName = "emit_review";
  const tools = [
    {
      type: "function",
      function: {
        name: toolName,
        description: "Emit the review text for the generated project.",
        parameters: {
          type: "object",
          required: ["review"],
          properties: {
            review: { type: "string" },
          },
        },
      },
    },
  ];

  onProgress?.({
    kind: "llm_call",
    stage: "reviewer",
    url,
    model,
    systemPromptPreview: truncateText(REVIEWER_SYSTEM),
    userMessagePreview: truncateText(userMessage, 2400),
  });

  const resp = await callOllamaWithTools(
    url,
    model,
    [{ role: "user", content: userMessage }],
    REVIEWER_SYSTEM,
    tools
  );

  const contentFull = resp?.message?.content ?? "";
  const toolCalls = resp?.message?.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const call = toolCalls[0];
    const args = call.function.arguments as unknown;
    onProgress?.({
      kind: "tool_call",
      stage: "reviewer",
      toolName,
      argumentsPreview: truncateText(JSON.stringify(args), 2400),
    });
    const parsed = args as { review?: string };
    if (typeof parsed?.review === "string") {
      return parsed.review.trim();
    }
  }

  onProgress?.({ kind: "llm_result", stage: "reviewer", contentPreview: truncateText(contentFull, 1200) });

  return contentFull.trim();
}
