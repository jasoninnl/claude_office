import type { Floor, Team, Scenario } from "./types";

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
export const createScenario = (data: {
  name: string;
  description: string;
  is_baseline: boolean;
  allocations: { team_id: number; floor_id: number; desks_used: number }[];
}) => req<Scenario>("/scenarios", { method: "POST", body: JSON.stringify(data) });
export const updateScenario = (
  id: number,
  data: {
    name: string;
    description: string;
    is_baseline: boolean;
    allocations: { team_id: number; floor_id: number; desks_used: number }[];
  }
) => req<Scenario>(`/scenarios/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteScenario = (id: number) =>
  req<void>(`/scenarios/${id}`, { method: "DELETE" });
export const duplicateScenario = (id: number) =>
  req<Scenario>(`/scenarios/${id}/duplicate`, { method: "POST" });

// Optimizer
export const runOptimizer = (data: {
  scenario_name: string;
  description: string;
  weights: Record<string, number>;
}) => req<Scenario>("/optimize", { method: "POST", body: JSON.stringify(data) });

export const rescoreScenario = (id: number) =>
  req<{ score: number; breakdown: object }>(`/scenarios/${id}/score`, { method: "POST" });
