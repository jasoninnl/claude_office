import { useRef, useState } from "react";
import { Upload, X, ImageIcon, Building2 } from "lucide-react";
import type { Scenario, Floor, Team } from "../types";
import * as api from "../api";
import FloorPlanCanvas from "./FloorPlanCanvas";

interface Props {
  scenario: Scenario | null;
  floors: Floor[];
  teams: Team[];
  onFloorChange: () => void;
  onScenarioChange: () => void;
}

export default function FloorPlanView({ scenario, floors, teams, onFloorChange, onScenarioChange }: Props) {
  const [activeFloorId, setActiveFloorId] = useState<number | null>(
    floors.length > 0 ? floors.sort((a, b) => b.level - a.level)[0].id : null
  );
  const [uploading, setUploading] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingForFloor = useRef<number | null>(null);

  const sortedFloors = [...floors].sort((a, b) => b.level - a.level);
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? sortedFloors[0] ?? null;

  const allocationsForFloor = (floorId: number) =>
    scenario?.allocations.filter((a) => a.floor_id === floorId) ?? [];

  const handleUploadClick = (floorId: number) => {
    uploadingForFloor.current = floorId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const floorId = uploadingForFloor.current;
    if (!file || !floorId) return;
    e.target.value = "";
    setUploading(floorId);
    try {
      await api.uploadFloorImage(floorId, file);
      onFloorChange();
    } finally {
      setUploading(null);
    }
  };

  const handleRemoveImage = async (floorId: number) => {
    await api.deleteFloorImage(floorId);
    onFloorChange();
  };

  if (!scenario) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No scenario selected. Create or select a scenario in the Scenarios tab first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Floor selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 mr-1">Floor:</span>
        {sortedFloors.map((floor) => {
          const allocs = allocationsForFloor(floor.id);
          const usedDesks = allocs.reduce((s, a) => s + (a.desks_used || a.team.headcount), 0);
          const utilPct = floor.total_desks > 0 ? Math.round((usedDesks / floor.total_desks) * 100) : 0;
          return (
            <button
              key={floor.id}
              onClick={() => setActiveFloorId(floor.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                activeFloorId === floor.id
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              <Building2 size={13} />
              {floor.name}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                utilPct > 100 ? "bg-red-900 text-red-300" :
                utilPct > 80 ? "bg-amber-900 text-amber-300" :
                "bg-gray-700 text-gray-400"
              }`}>
                {utilPct}%
              </span>
              {floor.image_path && <ImageIcon size={11} className="opacity-60" />}
            </button>
          );
        })}
      </div>

      {/* Active floor panel */}
      {activeFloor && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          {/* Floor header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div>
              <h3 className="font-semibold text-white">{activeFloor.name}</h3>
              <p className="text-xs text-gray-500">
                {scenario.name} · {allocationsForFloor(activeFloor.id).length} teams allocated
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeFloor.image_path ? (
                <button
                  onClick={() => handleRemoveImage(activeFloor.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <X size={12} /> Remove image
                </button>
              ) : null}
              <button
                onClick={() => handleUploadClick(activeFloor.id)}
                disabled={uploading === activeFloor.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploading === activeFloor.id ? (
                  <span className="animate-spin">⟳</span>
                ) : (
                  <Upload size={12} />
                )}
                {activeFloor.image_path ? "Replace floor plan" : "Upload floor plan"}
              </button>
            </div>
          </div>

          {/* Canvas */}
          <div className="p-4">
            <FloorPlanCanvas
              floor={activeFloor}
              allocations={allocationsForFloor(activeFloor.id)}
              onPositionsSaved={onScenarioChange}
            />
          </div>
        </div>
      )}

      {/* All floors mini-grid (overview) */}
      {sortedFloors.length > 1 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">All floors overview</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {sortedFloors.map((floor) => {
              const allocs = allocationsForFloor(floor.id);
              const usedDesks = allocs.reduce((s, a) => s + (a.desks_used || a.team.headcount), 0);
              const utilPct = floor.total_desks > 0 ? Math.round((usedDesks / floor.total_desks) * 100) : 0;
              const isActive = floor.id === activeFloorId;

              return (
                <button
                  key={floor.id}
                  onClick={() => setActiveFloorId(floor.id)}
                  className={`text-left rounded-xl border overflow-hidden transition-all hover:border-indigo-500 ${
                    isActive ? "border-indigo-500 ring-1 ring-indigo-500" : "border-gray-700"
                  }`}
                >
                  {/* Mini floor plan preview */}
                  <div className="relative" style={{ paddingBottom: "56.25%" }}>
                    <div className="absolute inset-0 bg-gray-950">
                      {floor.image_path ? (
                        <img
                          src={floor.image_path}
                          alt={floor.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <MiniGridBg />
                      )}
                      {/* Mini team blocks overlay */}
                      {allocs.slice(0, 6).map((alloc, i) => (
                        <div
                          key={alloc.team_id}
                          className="absolute rounded text-white flex items-center justify-center overflow-hidden"
                          style={{
                            backgroundColor: alloc.team.color + "bb",
                            left: `${2 + (i % 3) * 32}%`,
                            top: `${5 + Math.floor(i / 3) * 45}%`,
                            width: "30%",
                            height: "40%",
                            fontSize: "clamp(5px, 1.2vw, 9px)",
                            fontWeight: 600,
                          }}
                        >
                          {alloc.team.name.split(" ")[0]}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-2 bg-gray-900">
                    <p className="text-xs font-medium text-gray-200 truncate">{floor.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${utilPct > 100 ? "bg-red-500" : utilPct > 80 ? "bg-amber-400" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(utilPct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{utilPct}%</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniGridBg() {
  return (
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" className="bg-gray-900">
      <defs>
        <pattern id="minigrid" width="10%" height="10%" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1f2937" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#minigrid)" />
      <rect x="4%" y="4%" width="92%" height="92%" fill="none" stroke="#374151" strokeWidth="1" rx="2" />
    </svg>
  );
}
