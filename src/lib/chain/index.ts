import { getRoleUrl, type RoleOverrides } from "@/lib/roles";
import { runPlanner, type ProjectPlan } from "./planner";
import { runCoder } from "./coder";
import { runReviewer } from "./reviewer";
import { runRefiner } from "./refiner";

export interface GeneratedProject {
  projectName: string;
  description: string;
  files: { path: string; content: string }[];
}

export type RoleStage = "planner" | "coder" | "reviewer" | "refiner";

export type ChainProgressEvent =
  | {
      kind: "stage";
      stage: RoleStage;
      status: "started" | "done";
      current?: number;
      total?: number;
      filePath?: string;
    }
  | {
      kind: "llm_call";
      stage: RoleStage;
      url: string;
      model: string;
      systemPromptPreview?: string;
      userMessagePreview?: string;
    }
  | {
      kind: "tool_call";
      stage: RoleStage;
      toolName: string;
      argumentsPreview?: string;
    }
  | {
      kind: "llm_result";
      stage: RoleStage;
      contentPreview?: string;
    };

export interface RunChainOptions {
  roleOverrides?: RoleOverrides;
  onProgress?: (event: ChainProgressEvent) => void;
}

export class ChainStageError extends Error {
  stage: RoleStage;
  url: string;
  filePath?: string;

  constructor(stage: RoleStage, url: string, cause: unknown, filePath?: string) {
    const message = cause instanceof Error ? cause.message : "Unknown stage error";
    super(`${stage} failed at ${url}${filePath ? ` (file: ${filePath})` : ""}: ${message}`);
    this.name = "ChainStageError";
    this.stage = stage;
    this.url = url;
    this.filePath = filePath;
  }
}

export async function runChain(userPrompt: string, options?: RunChainOptions): Promise<GeneratedProject> {
  const roleOverrides = options?.roleOverrides;
  const plannerUrl = getRoleUrl("planner", roleOverrides);
  const coderUrl = getRoleUrl("coder", roleOverrides);
  const reviewerUrl = getRoleUrl("reviewer", roleOverrides);
  const refinerUrl = getRoleUrl("refiner", roleOverrides);

  options?.onProgress?.({ kind: "stage", stage: "planner", status: "started" });
  let plan: ProjectPlan;
  try {
    plan = await runPlanner(userPrompt, roleOverrides, options?.onProgress);
  } catch (error) {
    throw new ChainStageError("planner", plannerUrl, error);
  }
  options?.onProgress?.({ kind: "stage", stage: "planner", status: "done" });
  const files: { path: string; content: string }[] = [];

  options?.onProgress?.({ kind: "stage", stage: "coder", status: "started", current: 0, total: plan.files.length });
  for (let i = 0; i < plan.files.length; i++) {
    const file = plan.files[i];
    options?.onProgress?.({ kind: "stage", stage: "coder", status: "started", current: i, total: plan.files.length, filePath: file.path });
    let content: string;
    try {
      content = await runCoder(userPrompt, plan, file, files, roleOverrides, options?.onProgress);
    } catch (error) {
      throw new ChainStageError("coder", coderUrl, error, file.path);
    }
    files.push({ path: file.path, content });
    options?.onProgress?.({ kind: "stage", stage: "coder", status: "done", current: i + 1, total: plan.files.length, filePath: file.path });
  }

  options?.onProgress?.({ kind: "stage", stage: "reviewer", status: "started" });
  let review: string;
  try {
    review = await runReviewer(userPrompt, plan, files, roleOverrides, options?.onProgress);
  } catch (error) {
    throw new ChainStageError("reviewer", reviewerUrl, error);
  }
  options?.onProgress?.({ kind: "stage", stage: "reviewer", status: "done" });

  const refinedFiles: { path: string; content: string }[] = [];
  options?.onProgress?.({ kind: "stage", stage: "refiner", status: "started", current: 0, total: files.length });
  for (const f of files) {
    options?.onProgress?.({ kind: "stage", stage: "refiner", status: "started", current: refinedFiles.length, total: files.length, filePath: f.path });
    let refined: string;
    try {
      refined = await runRefiner(f.path, f.content, review, roleOverrides, options?.onProgress);
    } catch (error) {
      throw new ChainStageError("refiner", refinerUrl, error, f.path);
    }
    refinedFiles.push({ path: f.path, content: refined });
    options?.onProgress?.({ kind: "stage", stage: "refiner", status: "done", current: refinedFiles.length, total: files.length, filePath: f.path });
  }

  return {
    projectName: plan.projectName,
    description: plan.description,
    files: refinedFiles,
  };
}
