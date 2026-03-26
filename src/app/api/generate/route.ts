import { NextRequest, NextResponse } from "next/server";
import { runChain } from "@/lib/chain";
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { prompt, roleOverrides } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const overrides = sanitizeRoleOverrides(roleOverrides);
    const project = await runChain(prompt.trim(), { roleOverrides: overrides });
    return NextResponse.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    console.error("Generate error:", message, error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
