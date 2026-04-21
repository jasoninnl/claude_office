import { useState } from "react";
import { Plus, Copy, Trash2, Star, ChevronDown, ChevronRight, Zap, Pencil, Check, X } from "lucide-react";
import type { Scenario, Floor, Team } from "../types";
import * as api from "../api";
import ScenarioView from "./ScenarioView";
import OptimizerPanel from "./OptimizerPanel";

interface Props {
  scenarios: Scenario[];
  floors: Floor[];
  teams: Team[];
  activeScenarioId: number | null;
  onActiveScenarioChange: (id: number | null) => void;
  onScenarioChange: () => void;
}

export default function ScenarioManager({ scenarios, floors, teams, activeScenarioId, onActiveScenarioChange, onScenarioChange }: Props) {
  const activeScenario = activeScenarioId;
  const setActiveScenario = onActiveScenarioChange;
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [editingName, setEditingName] = useState<number | null>(null);
  const [nameInput, setNameInput] = useState("");

  const active = scenarios.find((s) => s.id === activeScenario);

  const handleNewScenario = async () => {
    const s = await api.createScenario({
      name: "New Scenario",
      description: "",
      is_baseline: false,
      allocations: [],
    });
    onScenarioChange();
    setActiveScenario(s.id);
  };

  const handleDuplicate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const s = await api.duplicateScenario(id);
    onScenarioChange();
    setActiveScenario(s.id);
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this scenario?")) return;
    await api.deleteScenario(id);
    onScenarioChange();
    if (activeScenario === id) {
      setActiveScenario(scenarios.find((s) => s.id !== id)?.id ?? null);
    }
  };

  const handleAllocationChange = async (teamId: number, floorId: number) => {
    if (!active) return;
    const existing = active.allocations.find((a) => a.team_id === teamId);
    const team = teams.find((t) => t.id === teamId);
    const desksUsed = team ? (team.required_desks || team.headcount) : 0;

    const newAllocs = existing
      ? active.allocations.map((a) =>
          a.team_id === teamId ? { ...a, floor_id: floorId, desks_used: desksUsed } : a
        )
      : [...active.allocations, { team_id: teamId, floor_id: floorId, desks_used: desksUsed, id: 0, team: team!, floor: floors.find((f) => f.id === floorId)! }];

    await api.updateScenario(active.id, {
      name: active.name,
      description: active.description,
      is_baseline: active.is_baseline,
      allocations: newAllocs.map((a) => ({
        team_id: a.team_id,
        floor_id: a.floor_id,
        desks_used: a.desks_used,
      })),
    });
    onScenarioChange();
  };

  const startRename = (s: Scenario, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(s.id);
    setNameInput(s.name);
  };

  const saveRename = async (s: Scenario) => {
    if (!nameInput.trim()) return;
    await api.updateScenario(s.id, {
      name: nameInput,
      description: s.description,
      is_baseline: s.is_baseline,
      allocations: s.allocations.map((a) => ({
        team_id: a.team_id,
        floor_id: a.floor_id,
        desks_used: a.desks_used,
      })),
    });
    setEditingName(null);
    onScenarioChange();
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-gray-500";
    if (score >= 50) return "text-emerald-400";
    if (score >= 0) return "text-amber-400";
    return "text-red-400";
  };

  return (
    <div className="space-y-4">
      {/* Scenario tabs */}
      <div className="flex items-start gap-2 flex-wrap">
        {scenarios.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveScenario(s.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              activeScenario === s.id
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {s.is_baseline && <Star size={11} className="text-amber-400" />}
            {editingName === s.id ? (
              <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  className="bg-transparent border-b border-white outline-none w-28 text-sm"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveRename(s); if (e.key === "Escape") setEditingName(null); }}
                />
                <Check size={12} onClick={() => saveRename(s)} />
                <X size={12} onClick={() => setEditingName(null)} />
              </span>
            ) : (
              <>
                <span>{s.name}</span>
                {s.score !== null && (
                  <span className={`text-xs font-mono ${activeScenario === s.id ? "text-white/70" : scoreColor(s.score)}`}>
                    {s.score.toFixed(0)}
                  </span>
                )}
              </>
            )}
            {activeScenario === s.id && editingName !== s.id && (
              <span className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil size={10} onClick={(e) => startRename(s, e)} />
                <Copy size={10} onClick={(e) => handleDuplicate(s.id, e)} />
                {!s.is_baseline && <Trash2 size={10} onClick={(e) => handleDelete(s.id, e)} />}
              </span>
            )}
          </button>
        ))}

        <button
          onClick={handleNewScenario}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg text-sm transition-colors"
        >
          <Plus size={14} /> New
        </button>

        <button
          onClick={() => setShowOptimizer((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-900 hover:bg-indigo-800 text-indigo-300 rounded-lg text-sm font-medium transition-colors ml-auto"
        >
          <Zap size={14} /> Optimise
          {showOptimizer ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {/* Optimizer panel */}
      {showOptimizer && (
        <OptimizerPanel
          onComplete={(newId) => {
            onScenarioChange();
            setActiveScenario(newId);
            setShowOptimizer(false);
          }}
        />
      )}

      {/* Active scenario */}
      {active ? (
        <ScenarioView
          scenario={active}
          floors={floors}
          teams={teams}
          onAllocationChange={handleAllocationChange}
        />
      ) : (
        <div className="text-center py-16 text-gray-500">
          <p>No scenarios yet. Create one or run the optimiser.</p>
        </div>
      )}
    </div>
  );
}
