import { useState, useEffect, useCallback } from "react";
import { Building2, Users, LayoutGrid, GitCompare, RefreshCw, Map } from "lucide-react";
import type { Floor, Team, Scenario, Tab } from "./types";
import * as api from "./api";
import FloorManager from "./components/FloorManager";
import TeamManager from "./components/TeamManager";
import ScenarioManager from "./components/ScenarioManager";
import CompareView from "./components/CompareView";
import FloorPlanView from "./components/FloorPlanView";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "scenarios", label: "Scenarios", icon: <LayoutGrid size={16} /> },
  { id: "floorplan", label: "Floor Plan", icon: <Map size={16} /> },
  { id: "compare", label: "Compare", icon: <GitCompare size={16} /> },
  { id: "floors", label: "Floors", icon: <Building2 size={16} /> },
  { id: "teams", label: "Teams", icon: <Users size={16} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("scenarios");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, t, s] = await Promise.all([api.getFloors(), api.getTeams(), api.getScenarios()]);
      setFloors(f);
      setTeams(t);
      setScenarios(s);
      setError(null);
      // Default to baseline or first scenario
      setActiveScenarioId((prev) => {
        if (prev && s.find((sc) => sc.id === prev)) return prev;
        return s.find((sc) => sc.is_baseline)?.id ?? s[0]?.id ?? null;
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { setRefreshing(true); load(); };

  const activeScenario = scenarios.find((s) => s.id === activeScenarioId) ?? null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading office data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3 max-w-md">
          <p className="text-red-400 font-semibold">Could not connect to backend</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <p className="text-gray-500 text-xs">Make sure the API server is running on port 8000.</p>
          <button onClick={refresh} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const totalHeadcount = teams.reduce((s, t) => s + t.headcount, 0);
  const totalDesks = floors.reduce((s, f) => s + f.total_desks, 0);
  const totalRooms = floors.reduce((s, f) => s + f.meeting_rooms.length, 0);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Building2 size={16} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-sm leading-tight">Office Allocation</h1>
              <p className="text-xs text-gray-500">Staff optimisation across {floors.length} floors</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-gray-500">
            <span><span className="text-gray-300 font-medium">{teams.length}</span> teams</span>
            <span><span className="text-gray-300 font-medium">{totalHeadcount}</span> people</span>
            <span><span className={`font-medium ${totalHeadcount > totalDesks ? "text-red-400" : "text-gray-300"}`}>{totalDesks}</span> desks</span>
            <span><span className="text-gray-300 font-medium">{totalRooms}</span> meeting rooms</span>
            <span><span className="text-gray-300 font-medium">{scenarios.length}</span> scenarios</span>
            {activeScenario && (
              <span className="border-l border-gray-700 pl-4">
                <span className="text-gray-500">Viewing: </span>
                <span className="text-indigo-400 font-medium">{activeScenario.name}</span>
              </span>
            )}
          </div>

          <button
            onClick={refresh}
            className={`p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors ${refreshing ? "animate-spin" : ""}`}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="max-w-7xl mx-auto px-4 flex gap-1 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-indigo-500 text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {tab === "scenarios" && (
          <ScenarioManager
            scenarios={scenarios}
            floors={floors}
            teams={teams}
            activeScenarioId={activeScenarioId}
            onActiveScenarioChange={setActiveScenarioId}
            onScenarioChange={load}
          />
        )}
        {tab === "floorplan" && (
          <FloorPlanView
            scenario={activeScenario}
            floors={floors}
            teams={teams}
            onFloorChange={load}
            onScenarioChange={load}
          />
        )}
        {tab === "compare" && <CompareView scenarios={scenarios} />}
        {tab === "floors" && <FloorManager floors={floors} onFloorChange={load} />}
        {tab === "teams" && <TeamManager teams={teams} onTeamChange={load} />}
      </main>
    </div>
  );
}
