export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type OllamaFunctionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

export type OllamaToolCall = {
  type: "function";
  function: {
    name: string;
    arguments: unknown;
    index?: number;
  };
};

export interface OllamaChatResponse {
  message: {
    content?: string;
    tool_calls?: OllamaToolCall[];
    thinking?: string;
  };
}

function parseToolArguments(args: unknown): unknown {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as unknown;
    } catch {
      return args;
    }
  }
  return args;
}

export async function callOllama(
  baseUrl: string,
  model: string,
  messages: OllamaMessage[],
  systemPrompt?: string
): Promise<string> {
  const fullMessages: OllamaMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: fullMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama at ${baseUrl}: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { message: { content: string } };
  return data.message?.content?.trim() ?? "";
}

export async function callOllamaWithTools(
  baseUrl: string,
  model: string,
  messages: OllamaMessage[],
  systemPrompt: string | undefined,
  tools: OllamaFunctionTool[]
): Promise<OllamaChatResponse> {
  const fullMessages: OllamaMessage[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: fullMessages,
      stream: false,
      tools,
      // Allow models to reason before choosing the tool call.
      think: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama at ${baseUrl}: ${response.status} ${text}`);
  }

  const data = (await response.json()) as OllamaChatResponse;

  // Normalize arguments so downstream parsing is easier.
  if (data?.message?.tool_calls?.length) {
    for (const tc of data.message.tool_calls) {
      tc.function.arguments = parseToolArguments(tc.function.arguments);
    }
  }

  return data;
}
