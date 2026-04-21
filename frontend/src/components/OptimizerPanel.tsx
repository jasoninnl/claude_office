import { useState } from "react";
import { Zap, Loader } from "lucide-react";
import * as api from "../api";

interface Props {
  onComplete: (scenarioId: number) => void;
}

const DEFAULT_WEIGHTS = {
  collaboration: 1.0,
  space_utilization: 1.0,
  meeting_rooms: 1.0,
  constraints: 2.0,
  floor_preference: 0.5,
};

const WEIGHT_LABELS: Record<string, string> = {
  collaboration: "Collaboration",
  space_utilization: "Space Utilisation",
  meeting_rooms: "Meeting Room Fit",
  constraints: "Hard Constraints",
  floor_preference: "Floor Preferences",
};

const WEIGHT_DESCRIPTIONS: Record<string, string> = {
  collaboration: "Reward co-locating teams that need to work together",
  space_utilization: "Reward well-utilised floors (60-90% ideal)",
  meeting_rooms: "Reward matching teams to floors with enough meeting rooms",
  constraints: "Penalise broken must-be-with / must-separate constraints",
  floor_preference: "Reward placing teams on their preferred floor",
};

export default function OptimizerPanel({ onComplete }: Props) {
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [name, setName] = useState("Optimised Layout");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.runOptimizer({
        scenario_name: name,
        description: "",
        weights,
      });
      onComplete(result.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-indigo-300 flex items-center gap-2">
          <Zap size={16} /> Optimisation Settings
        </h3>
        <p className="text-xs text-gray-400 mt-1">
          Uses simulated annealing to find the best allocation. Adjust weights to prioritise different objectives.
        </p>
      </div>

      <div>
        <label className="text-xs text-gray-400">Scenario Name</label>
        <input
          className="mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 max-w-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-3">
        <p className="text-xs text-gray-400 font-medium">Objective Weights</p>
        {Object.entries(weights).map(([key, val]) => (
          <div key={key} className="flex items-center gap-3">
            <div className="w-36 flex-shrink-0">
              <p className="text-sm text-gray-300">{WEIGHT_LABELS[key]}</p>
              <p className="text-xs text-gray-500">{WEIGHT_DESCRIPTIONS[key]}</p>
            </div>
            <input
              type="range" min={0} max={4} step={0.5}
              value={val}
              onChange={(e) =>
                setWeights((w) => ({ ...w, [key]: +e.target.value }))
              }
              className="flex-1 accent-indigo-500"
            />
            <span className="w-8 text-sm text-indigo-300 text-right font-mono">{val.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
      >
        {loading ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
        {loading ? "Optimising…" : "Run Optimiser"}
      </button>
    </div>
  );
}
