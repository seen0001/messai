"use client";

import { useState, useEffect, useCallback } from "react";
import JSZip from "jszip";

const STORAGE_KEY = "messai-role-overrides";

interface RoleConfig {
  id: string;
  name: string;
  description: string;
  url: string;
  model: string;
}

interface GeneratedProject {
  projectName: string;
  description: string;
  files: { path: string; content: string }[];
}

type RoleStage = "planner" | "coder" | "reviewer" | "refiner";

interface RoleProgress {
  status: "idle" | "running" | "done" | "error";
  current?: number;
  total?: number;
  filePath?: string;
}

interface StepLogItem {
  id: string;
  text: string;
}

function buildPreviewHtml(project: GeneratedProject | null): string | null {
  if (!project) return null;
  const indexFile = project.files.find((f) => f.path.toLowerCase().endsWith("index.html"));
  if (!indexFile) return null;

  const byPath = new Map(project.files.map((f) => [f.path.replace(/^\.?\//, ""), f.content]));
  let html = indexFile.content;

  // Inline local CSS links so preview works from srcDoc.
  html = html.replace(/<link([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi, (full, before, href, after) => {
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) return full;
    const css = byPath.get(href.replace(/^\.?\//, ""));
    if (!css) return full;
    return `<style data-from="${href}">\n${css}\n</style>`;
  });

  // Inline local script src so preview can execute JS.
  html = html.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*?)><\/script>/gi, (full, before, src, after) => {
    if (/^https?:\/\//i.test(src) || src.startsWith("//")) return full;
    const js = byPath.get(src.replace(/^\.?\//, ""));
    if (!js) return full;
    return `<script data-from="${src}"${before}${after}>\n${js}\n</script>`;
  });

  return html;
}

function loadOverrides(): Record<string, { url: string; model: string }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { url?: string; model?: string }>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, v]) => typeof v?.url === "string" || typeof v?.model === "string")
        .map(([k, v]) => [k, { url: v?.url ?? "", model: v?.model ?? "" }]),
    ) as Record<string, { url: string; model: string }>;
  } catch {
    return {};
  }
}

function saveOverrides(roles: RoleConfig[]) {
  if (typeof window === "undefined") return;
  const obj = Object.fromEntries(roles.map((r) => [r.id, { url: r.url, model: r.model }]));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [roles, setRoles] = useState<RoleConfig[]>([]);
  const [project, setProject] = useState<GeneratedProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [resultView, setResultView] = useState<"preview" | "code">("preview");
  const [stepLogs, setStepLogs] = useState<StepLogItem[]>([]);
  const [progress, setProgress] = useState<Record<RoleStage, RoleProgress>>({
    planner: { status: "idle" },
    coder: { status: "idle" },
    reviewer: { status: "idle" },
    refiner: { status: "idle" },
  });

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        const fromApi = (data.roles || []) as RoleConfig[];
        const overrides = loadOverrides();
        const merged = fromApi.map((r) => ({
          ...r,
          url: overrides[r.id]?.url ?? r.url,
          model: overrides[r.id]?.model ?? r.model,
        }));
        setRoles(merged);
      })
      .catch(() => setRoles([]));
  }, []);

  const updateRole = useCallback((id: string, field: "url" | "model", value: string) => {
    setRoles((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, [field]: value } : r));
      saveOverrides(next);
      return next;
    });
  }, []);

  const resetProgress = useCallback(() => {
    setProgress({
      planner: { status: "idle" },
      coder: { status: "idle" },
      reviewer: { status: "idle" },
      refiner: { status: "idle" },
    });
    setStepLogs([]);
  }, []);

  const appendStepLog = useCallback((text: string) => {
    const stamp = new Date().toLocaleTimeString();
    setStepLogs((prev) => [{ id: `${Date.now()}-${Math.random()}`, text: `${stamp} - ${text}` }, ...prev].slice(0, 24));
  }, []);

  const updateProgress = useCallback((evt: {
    stage: RoleStage;
    status: "started" | "done";
    current?: number;
    total?: number;
    filePath?: string;
  }) => {
    setProgress((prev) => {
      const current = prev[evt.stage];
      const nextStatus: RoleProgress["status"] = evt.status === "started" ? "running" : "done";
      return {
        ...prev,
        [evt.stage]: {
          ...current,
          status: nextStatus,
          current: evt.current ?? current.current,
          total: evt.total ?? current.total,
          filePath: evt.filePath ?? current.filePath,
        },
      };
    });
    const roleName = evt.stage.charAt(0).toUpperCase() + evt.stage.slice(1);
    if (evt.status === "started") {
      if (evt.filePath) {
        appendStepLog(`${roleName} started ${evt.filePath}`);
      } else {
        appendStepLog(`${roleName} started`);
      }
    } else if (evt.filePath && typeof evt.current === "number" && typeof evt.total === "number") {
      appendStepLog(`${roleName} finished ${evt.filePath} (${evt.current}/${evt.total})`);
    } else {
      appendStepLog(`${roleName} done`);
    }
  }, [appendStepLog]);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setProject(null);
    resetProgress();
    const roleOverrides = Object.fromEntries(roles.map((r) => [r.id, { url: r.url.trim(), model: r.model.trim() }]));
    try {
      const res = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), roleOverrides }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : "Generation failed";
        throw new Error(msg);
      }
      if (!res.body) {
        throw new Error("No progress stream returned");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      const handleSseBlock = (block: string) => {
        const lines = block.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) return;
        const parsed = JSON.parse(data) as unknown;

        if (event === "progress") {
          const evt = parsed as {
            kind?: string;
            stage?: RoleStage;
            status?: "started" | "done";
            current?: number;
            total?: number;
            filePath?: string;
            url?: string;
            model?: string;
            systemPromptPreview?: string;
            userMessagePreview?: string;
            toolName?: string;
            argumentsPreview?: string;
            contentPreview?: string;
          };

          if (evt.kind === "stage" && evt.stage && evt.status) {
            updateProgress(evt as { stage: RoleStage; status: "started" | "done"; current?: number; total?: number; filePath?: string });
          } else if (evt.kind === "llm_call" && evt.stage && evt.url && evt.model) {
            appendStepLog(
              `${evt.stage.toUpperCase()} llm_call url=${evt.url} model=${evt.model}\n` +
                `system=${evt.systemPromptPreview ?? ""}\n` +
                `user=${evt.userMessagePreview ?? ""}`
            );
          } else if (evt.kind === "tool_call" && evt.stage && evt.toolName) {
            appendStepLog(
              `${evt.stage.toUpperCase()} tool_call ${evt.toolName}\n` +
                `args=${evt.argumentsPreview ?? ""}`
            );
          } else if (evt.kind === "llm_result" && evt.stage) {
            appendStepLog(`${evt.stage.toUpperCase()} llm_result content=${evt.contentPreview ?? ""}`);
          }
        } else if (event === "project") {
          const p = parsed as GeneratedProject;
          setProject(p);
          setSelectedFile(p.files?.[0]?.path ?? null);
          setResultView("preview");
        } else if (event === "error") {
          const info = parsed as {
            message?: string;
            stage?: RoleStage;
            url?: string;
            filePath?: string;
          };
          const msg = info?.message || "Generation failed";
          if (info.stage) {
            appendStepLog(
              `${info.stage.charAt(0).toUpperCase() + info.stage.slice(1)} failed` +
                (info.filePath ? ` on ${info.filePath}` : "") +
                (info.url ? ` at ${info.url}` : "")
            );
          }
          setProgress((prev) => {
            const failedStage = info.stage;
            if (failedStage) {
              return { ...prev, [failedStage]: { ...prev[failedStage], status: "error", filePath: info.filePath ?? prev[failedStage].filePath } };
            }
            const firstRunning = (Object.keys(prev) as RoleStage[]).find((k) => prev[k].status === "running");
            if (!firstRunning) return prev;
            return { ...prev, [firstRunning]: { ...prev[firstRunning], status: "error" } };
          });
          const details = [msg, info.stage ? `stage=${info.stage}` : "", info.filePath ? `file=${info.filePath}` : "", info.url ? `url=${info.url}` : ""]
            .filter(Boolean)
            .join(" | ");
          throw new Error(details);
        }
      };

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const b of blocks) {
          if (b.trim()) handleSseBlock(b);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!project) return;
    const zip = new JSZip();
    const folder = zip.folder(project.projectName);
    if (!folder) return;
    for (const f of project.files) {
      folder.file(f.path, f.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.projectName}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selectedContent = project?.files.find((f) => f.path === selectedFile)?.content ?? "";
  const previewHtml = buildPreviewHtml(project);
  const roleLabel: Record<RoleStage, string> = {
    planner: "Planner",
    coder: "Coder",
    reviewer: "Reviewer",
    refiner: "Refiner",
  };
  const roleOrder: RoleStage[] = ["planner", "coder", "reviewer", "refiner"];
  const statusText = (stage: RoleStage, p: RoleProgress) => {
    if (p.status === "idle") return "Idle";
    if (p.status === "running") {
      if (typeof p.current === "number" && typeof p.total === "number") {
        return `Running (${p.current}/${p.total})`;
      }
      return "Running";
    }
    if (p.status === "done") {
      if (typeof p.current === "number" && typeof p.total === "number") {
        return `Done (${p.current}/${p.total})`;
      }
      return "Done";
    }
    return "Failed";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Mess.Ai</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Generate coded projects from a prompt. Each AI role runs on its own computer.</p>
      </header>

      <div className="flex-1 flex flex-col md:flex-row gap-6 p-6 max-w-7xl w-full mx-auto">
        {/* Left: prompt + roles */}
        <aside className="w-full md:w-96 flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Describe the project you want</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A React todo app with add, complete, and delete. Use Tailwind." className="w-full h-32 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" disabled={loading} />
          </div>
          <button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full rounded-xl bg-amber-500 px-4 py-3 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? "Generating… (Planner → Coder → Reviewer → Refiner)" : "Generate project"}
          </button>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-xs font-medium text-zinc-400 mb-2">Role progress</p>
            <ul className="space-y-2">
              {roleOrder.map((stage) => (
                <li key={stage} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">{roleLabel[stage]}</span>
                    <span
                      className={`${
                        progress[stage].status === "done"
                          ? "text-emerald-400"
                          : progress[stage].status === "running"
                            ? "text-amber-400"
                            : progress[stage].status === "error"
                              ? "text-red-400"
                              : "text-zinc-500"
                      }`}
                    >
                      {statusText(stage, progress[stage])}
                    </span>
                  </div>
                  {progress[stage].filePath && (
                    <p className="text-zinc-500 font-mono truncate mt-0.5">{progress[stage].filePath}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-xs font-medium text-zinc-400 mb-2">Live step log</p>
            <div className="max-h-40 overflow-auto space-y-1">
              {stepLogs.length === 0 && <p className="text-xs text-zinc-600">No steps yet.</p>}
              {stepLogs.map((item) => (
                <p key={item.id} className="text-xs text-zinc-400 font-mono">
                  {item.text}
                </p>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-4">
            <h2 className="text-sm font-medium text-zinc-400 mb-3">Roles (IP / Ollama URL per computer)</h2>
            <ul className="space-y-3">
              {roles.map((r) => (
                <li key={r.id} className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
                  <p className="font-medium text-zinc-200">{r.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{r.description}</p>
                  <label className="block mt-2">
                    <span className="text-xs text-zinc-500">URL</span>
                    <input type="text" value={r.url} onChange={(e) => updateRole(r.id, "url", e.target.value)} placeholder="http://IP:11434" className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500" disabled={loading} />
                  </label>
                  <label className="block mt-2">
                    <span className="text-xs text-zinc-500">Model</span>
                    <input type="text" value={r.model} onChange={(e) => updateRole(r.id, "model", e.target.value)} placeholder="qwen3:1.7b" className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500" disabled={loading} />
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-600 mt-3">Define each role’s Ollama URL (and model). Saved in this browser; same machine can be used for multiple roles.</p>
          </div>
        </aside>

        {/* Right: result */}
        <main className="flex-1 flex flex-col min-w-0 border border-zinc-800 rounded-xl bg-zinc-900 overflow-hidden">
          {error && <div className="p-4 bg-red-950/50 border-b border-red-900 text-red-200 text-sm">{error}</div>}
          {!project && !loading && !error && <div className="flex-1 flex items-center justify-center text-zinc-500 p-8">Enter a prompt and click Generate. Chain: Planner → Coder → Reviewer → Refiner (one role per computer).</div>}
          {loading && <div className="flex-1 flex items-center justify-center text-amber-400 p-8">Running agent chain…</div>}
          {project && (
            <>
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
                <div>
                  <h2 className="font-semibold text-zinc-100">{project.projectName}</h2>
                  {project.description && <p className="text-sm text-zinc-500">{project.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
                    <button
                      onClick={() => setResultView("preview")}
                      className={`px-3 py-2 text-sm ${resultView === "preview" ? "bg-zinc-700 text-zinc-100" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => setResultView("code")}
                      className={`px-3 py-2 text-sm ${resultView === "code" ? "bg-zinc-700 text-zinc-100" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}
                    >
                      Code
                    </button>
                  </div>
                  <button onClick={handleDownloadZip} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">
                    Download ZIP
                  </button>
                </div>
              </div>
              {resultView === "preview" ? (
                <div className="flex-1 min-h-0 p-4">
                  {previewHtml ? (
                    <iframe
                      title="Generated project preview"
                      srcDoc={previewHtml}
                      className="w-full h-full border border-zinc-800 rounded-lg bg-white"
                      sandbox="allow-scripts allow-same-origin"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                      Preview is available for projects with an `index.html` file. Switch to Code view to inspect files.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-1 min-h-0">
                  <div className="w-56 border-r border-zinc-800 overflow-y-auto py-2">
                    {project.files.map((f) => (
                      <button key={f.path} onClick={() => setSelectedFile(f.path)} className={`block w-full text-left px-4 py-2 text-sm font-mono truncate ${selectedFile === f.path ? "bg-zinc-800 text-amber-400" : "text-zinc-400 hover:bg-zinc-800/50"}`}>
                        {f.path}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    {selectedFile && (
                      <>
                        <p className="text-xs text-zinc-500 mb-2 font-mono">{selectedFile}</p>
                        <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono bg-zinc-950 rounded-lg p-4 overflow-x-auto">{selectedContent}</pre>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
