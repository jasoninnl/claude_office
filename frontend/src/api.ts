import type { Floor, Team, Scenario, Allocation } from "./types";

const BASE = "";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

// Floors
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
  return fetch(`/floors/${floorId}/image`, { method: "POST", body: form })
    .then((r) => r.json());
};

export const deleteFloorImage = (floorId: number) =>
  req<Floor>(`/floors/${floorId}/image`, { method: "DELETE" });

// Teams
export const getTeams = () => req<Team[]>("/teams");
export const createTeam = (data: Omit<Team, "id">) =>
  req<Team>("/teams", { method: "POST", body: JSON.stringify(data) });
export const updateTeam = (id: number, data: Omit<Team, "id">) =>
  req<Team>(`/teams/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteTeam = (id: number) =>
  req<void>(`/teams/${id}`, { method: "DELETE" });

// Scenarios
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

// Allocation positions
export const updateAllocationPosition = (
  allocId: number,
  pos: { pos_x: number; pos_y: number; pos_w: number; pos_h: number }
) => req<Allocation>(`/allocations/${allocId}/position`, { method: "PATCH", body: JSON.stringify(pos) });

// Optimizer
export const runOptimizer = (data: {
  scenario_name: string; description: string; weights: Record<string, number>;
}) => req<Scenario>("/optimize", { method: "POST", body: JSON.stringify(data) });

export const rescoreScenario = (id: number) =>
  req<{ score: number; breakdown: object }>(`/scenarios/${id}/score`, { method: "POST" });
