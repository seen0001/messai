import { callOllamaWithTools } from "../ollama";
import { getRoleUrl, getRoleModel, type RoleOverrides } from "../roles";
import type { ProjectPlan, PlannedFile } from "./planner";
import type { ChainProgressEvent } from ".";

const CODER_SYSTEM = `You are a code generator. You receive a project plan and must output the content for ONE file at a time.

You MUST call the tool \`emit_file\` with:
- content: the raw full file contents for the requested path

Rules:
- Do not output any other text.
- If the tool is somehow unavailable, fall back to outputting ONLY the raw file contents. 

When you receive a request for a specific file, output ONLY the file contents. No explanations, no markdown code fence, no "here is the code". Just the raw file content that can be written directly to disk.

If the file is JSON, HTML, CSS, or config, output valid content for that format. For code, use proper syntax and imports.`;

export async function runCoder(
  userPrompt: string,
  plan: ProjectPlan,
  file: PlannedFile,
  alreadyGenerated: { path: string; content: string }[],
  overrides?: RoleOverrides,
  onProgress?: (event: ChainProgressEvent) => void
): Promise<string> {
  const url = getRoleUrl("coder", overrides);
  const model = getRoleModel("coder", overrides);

  const context = alreadyGenerated.length
    ? `Already generated files (for reference):\n${alreadyGenerated
        .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 1500)}${f.content.length > 1500 ? "\n..." : ""}`)
        .join("\n\n")}`
    : "No other files generated yet.";

  const userMessage = `Project: ${plan.projectName}
Description: ${plan.description}

User request: ${userPrompt}

Full plan (all files):
${plan.files.map((f) => `- ${f.path}: ${f.purpose}`).join("\n")}

${context}

Generate the full content for this file only:
Path: ${file.path}
Purpose: ${file.purpose}

Output only the file contents, no commentary.`;

  function truncateText(s: string, max = 1600): string {
    const t = (s ?? "").toString();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  const toolName = "emit_file";
  const tools = [
    {
      type: "function",
      function: {
        name: toolName,
        description: "Emit the full content for exactly one file.",
        parameters: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", description: "Raw file content for the requested file path." },
          },
        },
      },
    },
  ];

  onProgress?.({
    kind: "llm_call",
    stage: "coder",
    url,
    model,
    systemPromptPreview: truncateText(CODER_SYSTEM),
    userMessagePreview: truncateText(userMessage, 2200),
  });

  const resp = await callOllamaWithTools(
    url,
    model,
    [{ role: "user", content: userMessage }],
    CODER_SYSTEM,
    tools
  );

  const contentFull = resp?.message?.content ?? "";
  const toolCalls = resp?.message?.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const call = toolCalls[0];
    const args = call.function.arguments as unknown;
    onProgress?.({
      kind: "tool_call",
      stage: "coder",
      toolName,
      argumentsPreview: truncateText(JSON.stringify(args), 2400),
    });

    const parsed = args as { content?: string };
    if (typeof parsed?.content === "string") {
      // Strip common wrappers (in case the model still wraps in markdown fences).
      let code = parsed.content.trim();
      const fenceMatch = code.match(/^```(?:[\w]*)\n?([\s\S]*?)```$/);
      if (fenceMatch) code = fenceMatch[1].trim();
      return code;
    }
  }

  onProgress?.({
    kind: "llm_result",
    stage: "coder",
    contentPreview: truncateText(contentFull, 1200),
  });

  // Fallback: parse from content as plain text.
  let code = contentFull.trim();
  const fenceMatch = code.match(/^```(?:[\w]*)\n?([\s\S]*?)```$/);
  if (fenceMatch) code = fenceMatch[1].trim();
  return code;
}
