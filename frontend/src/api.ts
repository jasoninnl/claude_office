import type { Floor, Team, Scenario, Allocation, FloorElement, PDFParseResult } from "./types";

const BASE = "";
const TOKEN_KEY = "auth_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const login = async (username: string, password: string) => {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Invalid credentials" }));
    throw new Error(err.detail || "Login failed");
  }
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.access_token);
};

export const logout = () => {
  clearToken();
  window.location.reload();
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeaders() },
    ...opts,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// ── Floors ───────────────────────────────────────────────────────────────────
export const getFloors = () => req<Floor[]>("/floors");
export const createFloor = (data: Omit<Floor, "id">) =>
  req<Floor>("/floors", { method: "POST", body: JSON.stringify(data) });
export const updateFloor = (id: number, data: Omit<Floor, "id">) =>
  req<Floor>(`/floors/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteFloor = (id: number) =>
  req<void>(`/floors/${id}`, { method: "DELETE" });

export const uploadFloorImage = (floorId: number, file: File): Promise<Floor> => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/floors/${floorId}/image`, { method: "POST", headers: authHeaders(), body: form }).then((r) => r.json());
};
export const deleteFloorImage = (floorId: number) =>
  req<Floor>(`/floors/${floorId}/image`, { method: "DELETE" });

// ── PDF processing ────────────────────────────────────────────────────────────
export const uploadFloorPdf = (floorId: number, file: File): Promise<PDFParseResult> => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/floors/${floorId}/pdf`, { method: "POST", headers: authHeaders(), body: form }).then(async (r) => {
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Upload failed");
    }
    return r.json();
  });
};
export const deleteFloorPdf = (floorId: number) =>
  req<Floor>(`/floors/${floorId}/pdf`, { method: "DELETE" });

// ── Floor elements ────────────────────────────────────────────────────────────
export const getFloorElements = (floorId: number, scenarioId?: number) => {
  const url = scenarioId
    ? `/floors/${floorId}/elements?scenario_id=${scenarioId}`
    : `/floors/${floorId}/elements`;
  return req<FloorElement[]>(url);
};

export const addFloorElement = (
  floorId: number,
  data: { element_type: string; nx: number; ny: number; nw?: number; nh?: number; label?: string }
) => req<FloorElement>(`/floors/${floorId}/elements`, { method: "POST", body: JSON.stringify(data) });

export const patchFloorElement = (
  elementId: number,
  data: { element_type?: string; team_id?: number | null; is_lead_office?: boolean; label?: string; nx?: number; ny?: number; nw?: number; nh?: number; scenario_id?: number }
) => req<FloorElement>(`/floor-elements/${elementId}`, { method: "PATCH", body: JSON.stringify(data) });

export const deleteFloorElement = (elementId: number) =>
  req<void>(`/floor-elements/${elementId}`, { method: "DELETE" });

export const bulkAssignElements = (
  floorId: number,
  elementIds: number[],
  teamId: number | null,
  scenarioId?: number
) =>
  req<FloorElement[]>(`/floors/${floorId}/elements/bulk-assign`, {
    method: "POST",
    body: JSON.stringify({ team_id: teamId, element_ids: elementIds, scenario_id: scenarioId }),
  });

export const autoAssignFloor = (floorId: number, scenarioId: number) =>
  req<FloorElement[]>(`/floors/${floorId}/auto-assign`, {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId }),
  });

// ── Teams ─────────────────────────────────────────────────────────────────────
export const getTeams = () => req<Team[]>("/teams");
export const createTeam = (data: Omit<Team, "id">) =>
  req<Team>("/teams", { method: "POST", body: JSON.stringify(data) });
export const updateTeam = (id: number, data: Omit<Team, "id">) =>
  req<Team>(`/teams/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteTeam = (id: number) =>
  req<void>(`/teams/${id}`, { method: "DELETE" });

// ── Scenarios ─────────────────────────────────────────────────────────────────
export const getScenarios = () => req<Scenario[]>("/scenarios");
export const getScenario = (id: number) => req<Scenario>(`/scenarios/${id}`);

type AllocItem = {
  team_id: number; floor_id: number; desks_used: number;
  pos_x?: number | null; pos_y?: number | null;
  pos_w?: number | null; pos_h?: number | null;
};
export const createScenario = (data: {
  name: string; description: string; is_baseline: boolean; allocations: AllocItem[];
}) => req<Scenario>("/scenarios", { method: "POST", body: JSON.stringify(data) });
export const updateScenario = (id: number, data: {
  name: string; description: string; is_baseline: boolean; allocations: AllocItem[];
}) => req<Scenario>(`/scenarios/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteScenario = (id: number) =>
  req<void>(`/scenarios/${id}`, { method: "DELETE" });
export const duplicateScenario = (id: number) =>
  req<Scenario>(`/scenarios/${id}/duplicate`, { method: "POST" });

export const updateAllocationPosition = (
  allocId: number,
  pos: { pos_x: number; pos_y: number; pos_w: number; pos_h: number }
) => req<Allocation>(`/allocations/${allocId}/position`, { method: "PATCH", body: JSON.stringify(pos) });

// ── Optimizer ─────────────────────────────────────────────────────────────────
export const runOptimizer = (data: {
  scenario_name: string; description: string; weights: Record<string, number>;
}) => req<Scenario>("/optimize", { method: "POST", body: JSON.stringify(data) });

export const rescoreScenario = (id: number) =>
  req<{ score: number; breakdown: object }>(`/scenarios/${id}/score`, { method: "POST" });
