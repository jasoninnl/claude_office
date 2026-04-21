import { useRef, useState, useCallback, useEffect } from "react";
import { Users, DoorOpen } from "lucide-react";
import type { Floor, Allocation } from "../types";
import * as api from "../api";

interface Pos { x: number; y: number; w: number; h: number }

interface Props {
  floor: Floor;
  allocations: Allocation[];
  onPositionsSaved?: () => void;
}

// Pack team blocks into rows proportional to desk count
function autoLayout(allocations: Allocation[], total: number): Map<number, Pos> {
  const map = new Map<number, Pos>();
  if (!allocations.length) return map;

  const MARGIN = 2;
  const GAP = 1;
  const availW = 100 - MARGIN * 2;
  const availH = 96 - MARGIN * 2;

  // Sort largest first for nicer layout
  const sorted = [...allocations].sort(
    (a, b) => (b.desks_used || b.team.headcount) - (a.desks_used || a.team.headcount)
  );

  // Determine rows: try to keep ~3 items per row
  const numRows = Math.max(1, Math.ceil(sorted.length / 3));
  const rowH = (availH - GAP * (numRows - 1)) / numRows;

  // Split into rows greedily by desk count target per row
  const rows: Allocation[][] = [];
  let current: Allocation[] = [];
  let currentTotal = 0;
  const targetPerRow = total / numRows;

  for (const alloc of sorted) {
    const desks = alloc.desks_used || alloc.team.headcount;
    current.push(alloc);
    currentTotal += desks;
    if (currentTotal >= targetPerRow && rows.length < numRows - 1) {
      rows.push(current);
      current = [];
      currentTotal = 0;
    }
  }
  if (current.length) rows.push(current);

  rows.forEach((row, ri) => {
    const rowTotal = row.reduce((s, a) => s + (a.desks_used || a.team.headcount), 0) || 1;
    let x = MARGIN;
    const y = MARGIN + ri * (rowH + GAP);
    row.forEach((alloc) => {
      const desks = alloc.desks_used || alloc.team.headcount;
      const w = Math.max(6, (desks / rowTotal) * availW - GAP);
      map.set(alloc.team_id, { x, y, w, h: rowH });
      x += w + GAP;
    });
  });

  return map;
}

function hex2rgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function FloorPlanCanvas({ floor, allocations, onPositionsSaved }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ teamId: number; startMouseX: number; startMouseY: number; startPos: Pos } | null>(null);

  const totalDesks = allocations.reduce((s, a) => s + (a.desks_used || a.team.headcount), 0) || 1;

  const initialPositions = useCallback(() => {
    const fromServer = new Map<number, Pos>();
    let hasServerPos = false;
    for (const a of allocations) {
      if (a.pos_x != null && a.pos_y != null && a.pos_w != null && a.pos_h != null) {
        fromServer.set(a.team_id, { x: a.pos_x, y: a.pos_y, w: a.pos_w, h: a.pos_h });
        hasServerPos = true;
      }
    }
    return hasServerPos ? fromServer : autoLayout(allocations, totalDesks);
  }, [allocations, totalDesks]);

  const [positions, setPositions] = useState<Map<number, Pos>>(initialPositions);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-layout when allocations change (new scenario loaded)
  useEffect(() => {
    setPositions(initialPositions());
    setDirty(false);
  }, [floor.id, allocations.map((a) => a.id).join(",")]);

  const pxToPercent = (px: number, dim: number) => (px / dim) * 100;

  const handleMouseDown = (e: React.MouseEvent, teamId: number) => {
    e.preventDefault();
    const pos = positions.get(teamId);
    if (!pos) return;
    dragRef.current = {
      teamId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPos: { ...pos },
    };
    setDragging(teamId);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current || !containerRef.current) return;
    const { teamId, startMouseX, startMouseY, startPos } = dragRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = pxToPercent(e.clientX - startMouseX, rect.width);
    const dy = pxToPercent(e.clientY - startMouseY, rect.height);

    setPositions((prev) => {
      const next = new Map(prev);
      const p = next.get(teamId)!;
      next.set(teamId, {
        ...p,
        x: Math.max(0, Math.min(100 - p.w, startPos.x + dx)),
        y: Math.max(0, Math.min(100 - p.h, startPos.y + dy)),
      });
      return next;
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(null);
      setDirty(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const savePositions = async () => {
    setSaving(true);
    try {
      await Promise.all(
        allocations.map((a) => {
          const pos = positions.get(a.team_id);
          if (!pos) return Promise.resolve();
          return api.updateAllocationPosition(a.id, {
            pos_x: pos.x, pos_y: pos.y, pos_w: pos.w, pos_h: pos.h,
          });
        })
      );
      setDirty(false);
      onPositionsSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const resetLayout = () => {
    setPositions(autoLayout(allocations, totalDesks));
    setDirty(true);
  };

  const usedDesks = allocations.reduce((s, a) => s + (a.desks_used || a.team.headcount), 0);
  const utilPct = floor.total_desks > 0 ? Math.round((usedDesks / floor.total_desks) * 100) : 0;

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className={utilPct > 100 ? "text-red-400" : utilPct > 80 ? "text-amber-400" : "text-emerald-400"}>
            {usedDesks}/{floor.total_desks} desks ({utilPct}%)
          </span>
          <span className="flex items-center gap-1">
            <DoorOpen size={12} />{floor.meeting_rooms.length} rooms
          </span>
          {floor.amenities.length > 0 && (
            <span>{floor.amenities.slice(0, 3).join(" · ")}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={resetLayout}
            className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
          >
            Auto-layout
          </button>
          {dirty && (
            <button
              onClick={savePositions}
              disabled={saving}
              className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save layout"}
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden select-none"
        style={{ paddingBottom: "56.25%" /* 16:9 aspect ratio */ }}
      >
        {/* Background: floor plan image or grid placeholder */}
        <div className="absolute inset-0">
          {floor.image_path ? (
            <img
              src={floor.image_path}
              alt={`${floor.name} floor plan`}
              className="w-full h-full object-contain bg-gray-950"
              draggable={false}
            />
          ) : (
            <GridPlaceholder floorName={floor.name} level={floor.level} />
          )}
        </div>

        {/* Team blocks */}
        {allocations.map((alloc) => {
          const pos = positions.get(alloc.team_id);
          if (!pos) return null;
          const isDragging = dragging === alloc.team_id;
          const desks = alloc.desks_used || alloc.team.headcount;
          const color = alloc.team.color;

          return (
            <div
              key={alloc.team_id}
              onMouseDown={(e) => handleMouseDown(e, alloc.team_id)}
              style={{
                position: "absolute",
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                width: `${pos.w}%`,
                height: `${pos.h}%`,
                backgroundColor: hex2rgba(color, 0.75),
                border: `2px solid ${color}`,
                borderRadius: "6px",
                cursor: isDragging ? "grabbing" : "grab",
                zIndex: isDragging ? 10 : 1,
                boxShadow: isDragging ? `0 4px 24px ${hex2rgba(color, 0.5)}` : `0 2px 8px rgba(0,0,0,0.4)`,
                transition: isDragging ? "none" : "box-shadow 0.15s",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                padding: "4px",
              }}
            >
              <div
                style={{
                  color: "white",
                  textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                  textAlign: "center",
                  width: "100%",
                  overflow: "hidden",
                }}
              >
                <div style={{ fontSize: "clamp(8px, 1.4vw, 14px)", fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {alloc.team.name}
                </div>
                <div style={{ fontSize: "clamp(7px, 1vw, 11px)", opacity: 0.9, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
                  <span>👤</span>{desks}
                  {alloc.team.department && <span style={{ opacity: 0.7 }}>· {alloc.team.department}</span>}
                </div>
              </div>
            </div>
          );
        })}

        {allocations.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            No teams allocated to this floor
          </div>
        )}
      </div>

      {/* Legend */}
      {allocations.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {allocations.map((a) => (
            <span
              key={a.team_id}
              className="flex items-center gap-1.5 text-xs text-gray-300"
            >
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: a.team.color }}
              />
              {a.team.name}
              <span className="text-gray-500">
                ({a.desks_used || a.team.headcount} desks)
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function GridPlaceholder({ floorName, level }: { floorName: string; level: number }) {
  const GRID = 12;
  return (
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" className="bg-gray-900">
      <defs>
        <pattern id={`grid-${level}`} width={`${100 / GRID}%`} height={`${100 / GRID}%`} patternUnits="userSpaceOnUse"
          patternTransform="scale(1)">
          <path d={`M ${100 / GRID} 0 L 0 0 0 ${100 / GRID}`} fill="none" stroke="#374151" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#grid-${level})`} />
      {/* Outer walls */}
      <rect x="3%" y="3%" width="94%" height="94%" fill="none" stroke="#4b5563" strokeWidth="2" rx="4" />
      {/* Generic room outlines */}
      <rect x="5%" y="5%" width="28%" height="18%" fill="#1f2937" stroke="#374151" strokeWidth="1" rx="2" />
      <rect x="35%" y="5%" width="28%" height="18%" fill="#1f2937" stroke="#374151" strokeWidth="1" rx="2" />
      <rect x="65%" y="5%" width="30%" height="18%" fill="#1f2937" stroke="#374151" strokeWidth="1" rx="2" />
      <rect x="5%" y="75%" width="90%" height="20%" fill="#1f2937" stroke="#374151" strokeWidth="1" rx="2" />
      {/* Label */}
      <text x="50%" y="52%" textAnchor="middle" fill="#374151" fontSize="clamp(12px,2vw,20px)" fontWeight="600">
        {floorName}
      </text>
      <text x="50%" y="60%" textAnchor="middle" fill="#374151" fontSize="clamp(9px,1.2vw,13px)">
        Upload a floor plan to show the real layout
      </text>
    </svg>
  );
}
