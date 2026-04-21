import { Users, DoorOpen, Package } from "lucide-react";
import type { Floor, Allocation, Team } from "../types";

interface Props {
  floor: Floor;
  allocations: Allocation[];
  teams: Team[];
  onTeamDrop?: (teamId: number, floorId: number) => void;
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
}

export default function FloorCard({
  floor,
  allocations,
  isDragOver,
  onDragOver,
  onDrop,
  onDragLeave,
}: Props) {
  const usedDesks = allocations.reduce((sum, a) => sum + (a.desks_used || a.team.headcount), 0);
  const utilPct = floor.total_desks > 0 ? (usedDesks / floor.total_desks) * 100 : 0;
  const overCapacity = usedDesks > floor.total_desks;

  const utilColor =
    overCapacity
      ? "bg-red-500"
      : utilPct >= 85
      ? "bg-amber-400"
      : utilPct >= 50
      ? "bg-emerald-500"
      : "bg-blue-400";

  return (
    <div
      className={`rounded-xl border transition-all ${
        isDragOver
          ? "border-indigo-400 bg-indigo-950/60"
          : "border-gray-700 bg-gray-900"
      }`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div>
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Floor {floor.level}
          </span>
          <h3 className="font-semibold text-white">{floor.name}</h3>
        </div>
        <div className="text-right">
          <p className={`text-sm font-bold ${overCapacity ? "text-red-400" : "text-gray-300"}`}>
            {usedDesks} / {floor.total_desks}
          </p>
          <p className="text-xs text-gray-500">desks used</p>
        </div>
      </div>

      {/* Utilisation bar */}
      <div className="px-4 pt-2 pb-1">
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${utilColor}`}
            style={{ width: `${Math.min(utilPct, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">{utilPct.toFixed(0)}% utilised</p>
      </div>

      {/* Team chips */}
      <div className="px-4 pb-3 min-h-[60px]">
        {allocations.length === 0 ? (
          <p className="text-xs text-gray-600 italic mt-2">No teams allocated</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {allocations.map((alloc) => (
              <span
                key={alloc.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: alloc.team.color + "cc" }}
                title={`${alloc.team.name}: ${alloc.desks_used || alloc.team.headcount} desks`}
              >
                <Users size={10} />
                {alloc.team.name}
                <span className="opacity-70">({alloc.desks_used || alloc.team.headcount})</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Facilities */}
      <div className="border-t border-gray-800 px-4 py-2 flex gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <DoorOpen size={12} />
          {floor.meeting_rooms.length} meeting rooms
        </span>
        {floor.amenities.length > 0 && (
          <span className="flex items-center gap-1">
            <Package size={12} />
            {floor.amenities.slice(0, 2).join(", ")}
            {floor.amenities.length > 2 && ` +${floor.amenities.length - 2}`}
          </span>
        )}
      </div>
    </div>
  );
}
