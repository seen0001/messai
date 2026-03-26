import { callOllamaWithTools } from "../ollama";
import { getRoleUrl, getRoleModel, type RoleOverrides } from "../roles";
import type { ChainProgressEvent } from ".";

const REFINER_SYSTEM = `You are a code refiner. You receive a file's current content and a reviewer's critique. Your job is to output an improved version of the file that addresses the review.

You MUST call the tool \`emit_refined_file\` with:
- content: the raw full refined file content for the given file path

Rules:
- Do not output any other text.
- If the tool is somehow unavailable, fall back to outputting ONLY the file contents.

Just the refined file content that can be written directly to disk. Preserve the file's purpose and format.`;

export async function runRefiner(
  filePath: string,
  currentContent: string,
  review: string,
  overrides?: RoleOverrides,
  onProgress?: (event: ChainProgressEvent) => void
): Promise<string> {
  const url = getRoleUrl("refiner", overrides);
  const model = getRoleModel("refiner", overrides);

  const userMessage = `Reviewer's critique:
${review}

Current content of ${filePath}:
---
${currentContent}
---

Output the refined content for this file only (full file, no commentary).`;

  function truncateText(s: string, max = 1600): string {
    const t = (s ?? "").toString();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  const toolName = "emit_refined_file";
  const tools = [
    {
      type: "function",
      function: {
        name: toolName,
        description: "Emit the refined content for a single file.",
        parameters: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", description: "Raw refined file content." },
          },
        },
      },
    },
  ];

  onProgress?.({
    kind: "llm_call",
    stage: "refiner",
    url,
    model,
    systemPromptPreview: truncateText(REFINER_SYSTEM),
    userMessagePreview: truncateText(userMessage, 2400),
  });

  const resp = await callOllamaWithTools(
    url,
    model,
    [{ role: "user", content: userMessage }],
    REFINER_SYSTEM,
    tools
  );

  const contentFull = resp?.message?.content ?? "";
  const toolCalls = resp?.message?.tool_calls ?? [];

  if (toolCalls.length > 0) {
    const call = toolCalls[0];
    const args = call.function.arguments as unknown;
    onProgress?.({
      kind: "tool_call",
      stage: "refiner",
      toolName,
      argumentsPreview: truncateText(JSON.stringify(args), 2400),
    });

    const parsed = args as { content?: string };
    if (typeof parsed?.content === "string") {
      let code = parsed.content.trim();
      const fenceMatch = code.match(/^```(?:[\w]*)\n?([\s\S]*?)```$/);
      if (fenceMatch) code = fenceMatch[1].trim();
      return code;
    }
  }

  onProgress?.({
    kind: "llm_result",
    stage: "refiner",
    contentPreview: truncateText(contentFull, 1200),
  });

  // Fallback: parse from plain assistant content.
  let code = contentFull.trim();
  const fenceMatch = code.match(/^```(?:[\w]*)\n?([\s\S]*?)```$/);
  if (fenceMatch) code = fenceMatch[1].trim();
  return code;
}
