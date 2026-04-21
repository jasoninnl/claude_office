import { useState } from "react";
import { Users, CheckCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import type { Scenario, Floor, Team } from "../types";
import FloorCard from "./FloorCard";

interface Props {
  scenario: Scenario;
  floors: Floor[];
  teams: Team[];
  onAllocationChange: (teamId: number, floorId: number) => void;
}

export default function ScenarioView({ scenario, floors, teams, onAllocationChange }: Props) {
  const [dragTeamId, setDragTeamId] = useState<number | null>(null);
  const [dragOverFloor, setDragOverFloor] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const allocsByFloor = (floorId: number) =>
    scenario.allocations.filter((a) => a.floor_id === floorId);

  const unallocatedTeams = teams.filter(
    (t) => !scenario.allocations.find((a) => a.team_id === t.id)
  );

  const score = scenario.score;
  const bd = scenario.score_breakdown;

  const scoreColor =
    score === null ? "text-gray-400"
    : score >= 50 ? "text-emerald-400"
    : score >= 0 ? "text-amber-400"
    : "text-red-400";

  return (
    <div className="space-y-4">
      {/* Score summary */}
      {bd && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Overall Score</p>
                <p className={`text-3xl font-bold ${scoreColor}`}>{score?.toFixed(1)}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <ScorePill label="Collaboration" value={bd.collaboration} />
                <ScorePill label="Space" value={bd.space_utilization} />
                <ScorePill label="Meeting Rooms" value={bd.meeting_rooms} />
                <ScorePill label="Constraints" value={-bd.constraint_violations} invert />
              </div>
            </div>
            <button
              className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
              onClick={() => setShowDetails((v) => !v)}
            >
              Details {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          {showDetails && bd.details.length > 0 && (
            <div className="mt-3 border-t border-gray-800 pt-3 space-y-1">
              {bd.details.map((d, i) => (
                <p key={i} className={`text-xs ${d.startsWith("✗") ? "text-red-400" : d.startsWith("⚠") ? "text-amber-400" : "text-emerald-400"}`}>
                  {d}
                </p>
              ))}
            </div>
          )}

          {/* Floor utilisation */}
          {bd.floor_utilization && (
            <div className="mt-3 border-t border-gray-800 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(bd.floor_utilization).map(([name, u]) => (
                <div key={name} className="text-xs">
                  <p className="text-gray-400 truncate">{name}</p>
                  <div className="flex items-center gap-1">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${u.pct > 100 ? "bg-red-500" : u.pct > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(u.pct, 100)}%` }}
                      />
                    </div>
                    <span className={u.pct > 100 ? "text-red-400" : "text-gray-300"}>{u.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unallocated teams */}
      {unallocatedTeams.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-700/50 rounded-xl p-3">
          <p className="text-xs text-amber-400 font-medium mb-2 flex items-center gap-1">
            <AlertTriangle size={12} /> Unallocated teams — drag to a floor
          </p>
          <div className="flex flex-wrap gap-2">
            {unallocatedTeams.map((team) => (
              <div
                key={team.id}
                draggable
                onDragStart={() => setDragTeamId(team.id)}
                onDragEnd={() => setDragTeamId(null)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white cursor-grab active:cursor-grabbing"
                style={{ backgroundColor: team.color + "cc" }}
              >
                <Users size={11} />
                {team.name} ({team.headcount})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floor grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...floors].sort((a, b) => b.level - a.level).map((floor) => (
          <FloorCard
            key={floor.id}
            floor={floor}
            allocations={allocsByFloor(floor.id)}
            teams={teams}
            isDragOver={dragOverFloor === floor.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFloor(floor.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragTeamId !== null) {
                onAllocationChange(dragTeamId, floor.id);
              }
              setDragOverFloor(null);
              setDragTeamId(null);
            }}
            onDragLeave={() => setDragOverFloor(null)}
          />
        ))}
      </div>
    </div>
  );
}

function ScorePill({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const positive = invert ? value <= 0 : value >= 0;
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${positive ? "text-emerald-400" : "text-red-400"}`}>
        {value >= 0 ? "+" : ""}{value.toFixed(1)}
      </p>
    </div>
  );
}
