import { useRef, useState, useEffect, useCallback } from "react";
import { Upload, X, ImageIcon, Building2, FileText, Wand2, MousePointer, Square, DoorOpen, CalendarRange, Printer } from "lucide-react";
import type { Scenario, Floor, Team, FloorElement, PDFParseResult } from "../types";
import * as api from "../api";
import FloorPlanCanvas from "./FloorPlanCanvas";
import PdfFloorPlanCanvas from "./PdfFloorPlanCanvas";

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
  const [uploadingPdf, setUploadingPdf] = useState<number | null>(null);
  const [elements, setElements] = useState<FloorElement[]>([]);
  const [loadingElements, setLoadingElements] = useState(false);
  const [pdfResult, setPdfResult] = useState<PDFParseResult | null>(null);
  const [drawMode, setDrawMode] = useState<"none" | "desk" | "office" | "meeting_room">("none");
  const [autoAssigning, setAutoAssigning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const uploadingForFloor = useRef<number | null>(null);

  const sortedFloors = [...floors].sort((a, b) => b.level - a.level);
  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? sortedFloors[0] ?? null;

  const loadElements = useCallback(async (floorId: number) => {
    setLoadingElements(true);
    try {
      const data = await api.getFloorElements(floorId);
      setElements(data);
    } finally {
      setLoadingElements(false);
    }
  }, []);

  useEffect(() => {
    if (activeFloor?.pdf_path) {
      loadElements(activeFloor.id);
    } else {
      setElements([]);
    }
  }, [activeFloor?.id, activeFloor?.pdf_path, loadElements]);

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

  const handlePdfUploadClick = (floorId: number) => {
    uploadingForFloor.current = floorId;
    pdfInputRef.current?.click();
  };

  const handlePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const floorId = uploadingForFloor.current;
    if (!file || !floorId) return;
    e.target.value = "";
    setUploadingPdf(floorId);
    setPdfResult(null);
    try {
      const result = await api.uploadFloorPdf(floorId, file);
      setPdfResult(result);
      onFloorChange();
    } finally {
      setUploadingPdf(null);
    }
  };

  const handleRemovePdf = async (floorId: number) => {
    await api.deleteFloorPdf(floorId);
    setElements([]);
    setPdfResult(null);
    onFloorChange();
  };

  const handleAutoAssign = async () => {
    if (!activeFloor || !scenario) return;
    setAutoAssigning(true);
    try {
      await api.autoAssignFloor(activeFloor.id, scenario.id);
      await loadElements(activeFloor.id);
      onScenarioChange();
    } finally {
      setAutoAssigning(false);
    }
  };

  const handlePrint = () => {
    if (!activeFloor) return;
    const ar = activeFloor.pdf_page_width && activeFloor.pdf_page_height
      ? activeFloor.pdf_page_width / activeFloor.pdf_page_height
      : 16 / 9;

    const svgEl = document.querySelector('[data-print-svg]') as SVGElement | null;
    const svgHtml = svgEl ? svgEl.outerHTML : "";
    const imgSrc = activeFloor.image_path
      ? `${window.location.origin}${activeFloor.image_path}` : "";

    const deskCount = elements.filter((e) => e.element_type === "desk").length;
    const officeCount = elements.filter((e) => e.element_type === "office").length;
    const mrCount = elements.filter((e) => e.element_type === "meeting_room").length;
    const allocs = scenario ? allocationsForFloor(activeFloor.id) : [];

    const legendItems = hasPdf
      ? teams
          .map((t) => ({ t, count: elements.filter((e) => e.element_type === "desk" && e.team_id === t.id).length }))
          .filter(({ count }) => count > 0)
          .map(({ t, count }) =>
            `<div class="li"><div class="lc" style="background:${t.color}"></div><span>${t.name} — ${count} desks</span></div>`)
          .join("")
      : allocs
          .map((a) =>
            `<div class="li"><div class="lc" style="background:${a.team.color}"></div><span>${a.team.name} — ${a.desks_used} desks</span></div>`)
          .join("");

    const subtitle = hasPdf
      ? [deskCount && `${deskCount} desks`, officeCount && `${officeCount} offices`, mrCount && `${mrCount} meeting rooms`]
          .filter(Boolean).join(" · ")
      : scenario ? `${scenario.name} · ${allocs.length} teams` : "";

    const pw = window.open("", "_blank");
    if (!pw) return;

    pw.document.write(`<!DOCTYPE html>
<html><head>
  <title>${activeFloor.name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{padding:24px;font-family:-apple-system,Helvetica,sans-serif;color:#111;background:#fff}
    h1{font-size:18pt;margin-bottom:4px}
    .sub{font-size:10pt;color:#555;margin-bottom:18px}
    .canvas{position:relative;width:100%;overflow:hidden}
    .canvas img{display:block;width:100%;height:100%;object-fit:fill}
    .canvas svg{position:absolute;top:0;left:0;width:100%;height:100%}
    .legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;border-top:1px solid #ddd;padding-top:14px}
    .li{display:flex;align-items:center;gap:6px;font-size:10pt}
    .lc{width:12px;height:12px;border-radius:2px;flex-shrink:0}
    @media print{body{padding:8px}@page{margin:1cm}}
  </style>
</head><body>
  <h1>${activeFloor.name}</h1>
  ${subtitle ? `<div class="sub">${subtitle}</div>` : ""}
  <div class="canvas" style="aspect-ratio:${ar}">
    ${imgSrc ? `<img src="${imgSrc}" />` : ""}
    ${svgHtml}
  </div>
  ${legendItems ? `<div class="legend">${legendItems}</div>` : ""}
  <script>window.onload=function(){window.print()}<\/script>
</body></html>`);
    pw.document.close();
  };

  const hasPdf = !!(activeFloor?.pdf_path);

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      <input ref={pdfInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfChange} />

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
              {floor.pdf_path && <FileText size={11} className="opacity-60" />}
              {floor.image_path && !floor.pdf_path && <ImageIcon size={11} className="opacity-60" />}
            </button>
          );
        })}
      </div>

      {/* Active floor panel */}
      {activeFloor && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          {/* Floor header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-white">{activeFloor.name}</h3>
              <p className="text-xs text-gray-500">
                {scenario ? `${scenario.name} · ${allocationsForFloor(activeFloor.id).length} teams allocated` : "No scenario selected"}
                {hasPdf && elements.length > 0 && (
                  <> · {elements.filter((e) => e.element_type === "desk").length} desks
                  {elements.filter((e) => e.element_type === "office").length > 0 && `, ${elements.filter((e) => e.element_type === "office").length} offices`}
                  {elements.filter((e) => e.element_type === "meeting_room").length > 0 && `, ${elements.filter((e) => e.element_type === "meeting_room").length} meeting rooms`}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {hasPdf ? (
                <button
                  onClick={() => handleRemovePdf(activeFloor.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <X size={12} /> Remove PDF
                </button>
              ) : (
                <button
                  onClick={() => handlePdfUploadClick(activeFloor.id)}
                  disabled={uploadingPdf === activeFloor.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-purple-700 hover:bg-purple-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploadingPdf === activeFloor.id ? <span className="animate-spin">⟳</span> : <FileText size={12} />}
                  Upload PDF floor plan
                </button>
              )}
              {!hasPdf && (
                <>
                  {activeFloor.image_path && (
                    <button
                      onClick={() => handleRemoveImage(activeFloor.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <X size={12} /> Remove image
                    </button>
                  )}
                  <button
                    onClick={() => handleUploadClick(activeFloor.id)}
                    disabled={uploading === activeFloor.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {uploading === activeFloor.id ? <span className="animate-spin">⟳</span> : <Upload size={12} />}
                    {activeFloor.image_path ? "Replace floor plan" : "Upload floor plan"}
                  </button>
                </>
              )}
              {(activeFloor.image_path || activeFloor.pdf_path) && (
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <Printer size={12} /> Print
                </button>
              )}
            </div>
          </div>

          {/* PDF toolbar */}
          {hasPdf && (
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-800 flex-wrap">
              <span className="text-xs text-gray-500">Draw:</span>
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${drawMode === "none" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                onClick={() => setDrawMode("none")}
              >
                <MousePointer size={11} /> Select
              </button>
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${drawMode === "desk" ? "bg-emerald-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                onClick={() => setDrawMode(drawMode === "desk" ? "none" : "desk")}
              >
                <Square size={11} /> Place Desk
              </button>
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${drawMode === "office" ? "bg-amber-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                onClick={() => setDrawMode(drawMode === "office" ? "none" : "office")}
              >
                <DoorOpen size={11} /> Place Office
              </button>
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${drawMode === "meeting_room" ? "bg-teal-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                onClick={() => setDrawMode(drawMode === "meeting_room" ? "none" : "meeting_room")}
              >
                <CalendarRange size={11} /> Place Meeting Room
              </button>
              <div className="flex-1" />
              <button
                onClick={handleAutoAssign}
                disabled={autoAssigning || elements.length === 0 || !scenario}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
              >
                {autoAssigning ? <span className="animate-spin">⟳</span> : <Wand2 size={12} />}
                Auto-assign teams
              </button>
            </div>
          )}

          {/* PDF parse result */}
          {pdfResult && pdfResult.warnings.length > 0 && (
            <div className="px-4 py-2 bg-amber-950 border-b border-amber-800">
              <p className="text-xs font-medium text-amber-400 mb-1">PDF parse warnings:</p>
              {pdfResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-300">• {w}</p>
              ))}
            </div>
          )}
          {hasPdf && elements.length > 0 && (
            <div className="px-4 py-2 bg-gray-950 border-b border-gray-800 text-xs text-gray-500">
              {elements.filter((e) => e.element_type === "desk").length} desks ·{" "}
              {elements.filter((e) => e.element_type === "office").length} offices ·{" "}
              {elements.filter((e) => e.element_type === "meeting_room").length} meeting rooms
            </div>
          )}

          {/* Canvas */}
          <div className="p-4">
            {hasPdf ? (
              loadingElements ? (
                <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                  Loading floor elements…
                </div>
              ) : (
                <PdfFloorPlanCanvas
                  floor={activeFloor}
                  elements={elements}
                  teams={teams}
                  drawMode={drawMode}
                  onDrawModeChange={setDrawMode}
                  onElementsChange={() => { loadElements(activeFloor.id); onFloorChange(); onScenarioChange(); }}
                />
              )
            ) : scenario ? (
              <FloorPlanCanvas
                floor={activeFloor}
                allocations={allocationsForFloor(activeFloor.id)}
                onPositionsSaved={onScenarioChange}
              />
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                Upload a PDF floor plan above, or select a scenario in the Scenarios tab to view team allocations.
              </div>
            )}
          </div>
        </div>
      )}

      {/* All floors mini-grid overview */}
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
