import { NextRequest } from "next/server";
import { runChain, type ChainProgressEvent, ChainStageError } from "@/lib/chain";
import type { RoleOverrides } from "@/lib/roles";

export const maxDuration = 120;

const ROLE_IDS = ["planner", "coder", "reviewer", "refiner"] as const;

function sanitizeRoleOverrides(raw: unknown): RoleOverrides | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const result: RoleOverrides = {};
  for (const id of ROLE_IDS) {
    const v = o[id];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entry = v as Record<string, unknown>;
      const url = entry.url;
      const model = entry.model;
      if (typeof url === "string" && url.trim()) result[id] = { ...result[id], url: url.trim() };
      if (typeof model === "string" && model.trim()) result[id] = { ...result[id], model: model.trim() };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { prompt, roleOverrides } = body;
  if (!prompt || typeof prompt !== "string") {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const overrides = sanitizeRoleOverrides(roleOverrides);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(toSse(event, data)));
      };

      const onProgress = (progress: ChainProgressEvent) => {
        send("progress", progress);
      };

      (async () => {
        try {
          const project = await runChain(prompt.trim(), { roleOverrides: overrides, onProgress });
          send("project", project);
          send("done", { ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Generation failed";
          if (error instanceof ChainStageError) {
            send("error", {
              message,
              stage: error.stage,
              url: error.url,
              filePath: error.filePath,
            });
          } else {
            send("error", { message });
          }
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
