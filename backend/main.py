from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, selectinload
from typing import List
from pathlib import Path
import os
import uuid

from database import engine, get_db
from models import Base, Floor, Team, Scenario, Allocation
from schemas import (
    FloorCreate, FloorUpdate, FloorOut,
    TeamCreate, TeamUpdate, TeamOut,
    ScenarioCreate, ScenarioUpdate, ScenarioOut,
    AllocationItem, AllocationOut, AllocationPositionUpdate, OptimizeRequest,
)
from optimizer import simulated_annealing, score_allocation

Base.metadata.create_all(bind=engine)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Office Staff Allocation Optimizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


# ── Floors ──────────────────────────────────────────────────────────────────

@app.get("/floors", response_model=List[FloorOut])
def list_floors(db: Session = Depends(get_db)):
    return db.query(Floor).order_by(Floor.level).all()


@app.post("/floors", response_model=FloorOut)
def create_floor(body: FloorCreate, db: Session = Depends(get_db)):
    floor = Floor(**body.model_dump())
    db.add(floor)
    db.commit()
    db.refresh(floor)
    return floor


@app.put("/floors/{floor_id}", response_model=FloorOut)
def update_floor(floor_id: int, body: FloorUpdate, db: Session = Depends(get_db)):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    for k, v in body.model_dump().items():
        setattr(floor, k, v)
    db.commit()
    db.refresh(floor)
    return floor


@app.delete("/floors/{floor_id}")
def delete_floor(floor_id: int, db: Session = Depends(get_db)):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    db.delete(floor)
    db.commit()
    return {"ok": True}


@app.post("/floors/{floor_id}/image", response_model=FloorOut)
async def upload_floor_image(
    floor_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    suffix = Path(file.filename).suffix.lower() if file.filename else ".png"
    if suffix not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}:
        raise HTTPException(400, "Unsupported image format")
    filename = f"floor_{floor_id}_{uuid.uuid4().hex[:8]}{suffix}"
    dest = UPLOAD_DIR / filename
    content = await file.read()
    dest.write_bytes(content)
    # Remove old image if present
    if floor.image_path:
        old = UPLOAD_DIR / Path(floor.image_path).name
        if old.exists():
            old.unlink()
    floor.image_path = f"/uploads/{filename}"
    db.commit()
    db.refresh(floor)
    return floor


@app.delete("/floors/{floor_id}/image", response_model=FloorOut)
def delete_floor_image(floor_id: int, db: Session = Depends(get_db)):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    if floor.image_path:
        old = UPLOAD_DIR / Path(floor.image_path).name
        if old.exists():
            old.unlink()
    floor.image_path = None
    db.commit()
    db.refresh(floor)
    return floor


# ── Teams ────────────────────────────────────────────────────────────────────

@app.get("/teams", response_model=List[TeamOut])
def list_teams(db: Session = Depends(get_db)):
    return db.query(Team).order_by(Team.name).all()


@app.post("/teams", response_model=TeamOut)
def create_team(body: TeamCreate, db: Session = Depends(get_db)):
    team = Team(**body.model_dump())
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


@app.put("/teams/{team_id}", response_model=TeamOut)
def update_team(team_id: int, body: TeamUpdate, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Team not found")
    for k, v in body.model_dump().items():
        setattr(team, k, v)
    db.commit()
    db.refresh(team)
    return team


@app.delete("/teams/{team_id}")
def delete_team(team_id: int, db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Team not found")
    db.delete(team)
    db.commit()
    return {"ok": True}


# ── Scenarios ────────────────────────────────────────────────────────────────

def _load_scenario(db: Session, scenario_id: int) -> Scenario:
    scenario = (
        db.query(Scenario)
        .options(
            selectinload(Scenario.allocations)
            .selectinload(Allocation.team),
            selectinload(Scenario.allocations)
            .selectinload(Allocation.floor),
        )
        .filter(Scenario.id == scenario_id)
        .first()
    )
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    return scenario


@app.get("/scenarios", response_model=List[ScenarioOut])
def list_scenarios(db: Session = Depends(get_db)):
    scenarios = (
        db.query(Scenario)
        .options(
            selectinload(Scenario.allocations).selectinload(Allocation.team),
            selectinload(Scenario.allocations).selectinload(Allocation.floor),
        )
        .all()
    )
    return scenarios


@app.get("/scenarios/{scenario_id}", response_model=ScenarioOut)
def get_scenario(scenario_id: int, db: Session = Depends(get_db)):
    return _load_scenario(db, scenario_id)


@app.post("/scenarios", response_model=ScenarioOut)
def create_scenario(body: ScenarioCreate, db: Session = Depends(get_db)):
    scenario = Scenario(
        name=body.name,
        description=body.description,
        is_baseline=body.is_baseline,
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)

    for item in body.allocations:
        alloc = Allocation(
            scenario_id=scenario.id,
            team_id=item.team_id,
            floor_id=item.floor_id,
            desks_used=item.desks_used,
            pos_x=item.pos_x,
            pos_y=item.pos_y,
            pos_w=item.pos_w,
            pos_h=item.pos_h,
        )
        db.add(alloc)
    db.commit()

    _rescore_scenario(db, scenario.id)
    return _load_scenario(db, scenario.id)


@app.put("/scenarios/{scenario_id}", response_model=ScenarioOut)
def update_scenario(scenario_id: int, body: ScenarioUpdate, db: Session = Depends(get_db)):
    scenario = db.get(Scenario, scenario_id)
    if not scenario:
        raise HTTPException(404, "Scenario not found")

    scenario.name = body.name
    scenario.description = body.description
    scenario.is_baseline = body.is_baseline

    # Replace allocations
    db.query(Allocation).filter(Allocation.scenario_id == scenario_id).delete()
    for item in body.allocations:
        alloc = Allocation(
            scenario_id=scenario_id,
            team_id=item.team_id,
            floor_id=item.floor_id,
            desks_used=item.desks_used,
            pos_x=item.pos_x,
            pos_y=item.pos_y,
            pos_w=item.pos_w,
            pos_h=item.pos_h,
        )
        db.add(alloc)
    db.commit()

    _rescore_scenario(db, scenario_id)
    return _load_scenario(db, scenario_id)


@app.delete("/scenarios/{scenario_id}")
def delete_scenario(scenario_id: int, db: Session = Depends(get_db)):
    scenario = db.get(Scenario, scenario_id)
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    db.delete(scenario)
    db.commit()
    return {"ok": True}


@app.post("/scenarios/{scenario_id}/duplicate", response_model=ScenarioOut)
def duplicate_scenario(scenario_id: int, db: Session = Depends(get_db)):
    src = _load_scenario(db, scenario_id)
    copy = Scenario(
        name=f"{src.name} (copy)",
        description=src.description,
        is_baseline=False,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    for alloc in src.allocations:
        db.add(Allocation(
            scenario_id=copy.id,
            team_id=alloc.team_id,
            floor_id=alloc.floor_id,
            desks_used=alloc.desks_used,
        ))
    db.commit()
    _rescore_scenario(db, copy.id)
    return _load_scenario(db, copy.id)


# ── Optimizer ────────────────────────────────────────────────────────────────

@app.post("/optimize", response_model=ScenarioOut)
def run_optimizer(body: OptimizeRequest, db: Session = Depends(get_db)):
    teams = db.query(Team).all()
    floors = db.query(Floor).all()

    if not teams:
        raise HTTPException(400, "No teams defined")
    if not floors:
        raise HTTPException(400, "No floors defined")

    teams_data = [
        {
            "id": t.id, "name": t.name, "headcount": t.headcount,
            "required_desks": t.required_desks,
            "min_meeting_room_capacity": t.min_meeting_room_capacity,
            "meeting_rooms_needed": t.meeting_rooms_needed,
            "must_be_with": t.must_be_with or [],
            "must_be_near": t.must_be_near or [],
            "must_separate_from": t.must_separate_from or [],
            "floor_preference": t.floor_preference,
        }
        for t in teams
    ]
    floors_data = [
        {
            "id": f.id, "name": f.name, "level": f.level,
            "total_desks": f.total_desks,
            "meeting_rooms": f.meeting_rooms or [],
        }
        for f in floors
    ]

    best_alloc, best_score, breakdown = simulated_annealing(
        teams_data, floors_data, body.weights, iterations=8000, seed=42
    )

    scenario = Scenario(
        name=body.scenario_name,
        description=body.description or f"Auto-optimized (score: {best_score:.1f})",
        score=best_score,
        score_breakdown=breakdown,
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)

    team_desks = {t["id"]: (t["required_desks"] or t["headcount"]) for t in teams_data}
    for tid, fid in best_alloc.items():
        db.add(Allocation(
            scenario_id=scenario.id,
            team_id=tid,
            floor_id=fid,
            desks_used=team_desks.get(tid, 0),
        ))
    db.commit()

    return _load_scenario(db, scenario.id)


@app.patch("/allocations/{allocation_id}/position", response_model=AllocationOut)
def update_allocation_position(
    allocation_id: int,
    body: AllocationPositionUpdate,
    db: Session = Depends(get_db),
):
    alloc = (
        db.query(Allocation)
        .options(selectinload(Allocation.team), selectinload(Allocation.floor))
        .filter(Allocation.id == allocation_id)
        .first()
    )
    if not alloc:
        raise HTTPException(404, "Allocation not found")
    alloc.pos_x = body.pos_x
    alloc.pos_y = body.pos_y
    alloc.pos_w = body.pos_w
    alloc.pos_h = body.pos_h
    db.commit()
    db.refresh(alloc)
    return alloc


@app.post("/scenarios/{scenario_id}/score")
def rescore(scenario_id: int, db: Session = Depends(get_db)):
    _rescore_scenario(db, scenario_id)
    scenario = db.get(Scenario, scenario_id)
    return {"score": scenario.score, "breakdown": scenario.score_breakdown}


def _rescore_scenario(db: Session, scenario_id: int):
    allocs = db.query(Allocation).filter(Allocation.scenario_id == scenario_id).all()
    if not allocs:
        return

    team_ids = [a.team_id for a in allocs]
    floor_ids = list({a.floor_id for a in allocs})

    teams = db.query(Team).filter(Team.id.in_(team_ids)).all()
    floors = db.query(Floor).all()

    teams_data = [
        {
            "id": t.id, "name": t.name, "headcount": t.headcount,
            "required_desks": t.required_desks,
            "min_meeting_room_capacity": t.min_meeting_room_capacity,
            "meeting_rooms_needed": t.meeting_rooms_needed,
            "must_be_with": t.must_be_with or [],
            "must_be_near": t.must_be_near or [],
            "must_separate_from": t.must_separate_from or [],
            "floor_preference": t.floor_preference,
        }
        for t in teams
    ]
    floors_data = [
        {
            "id": f.id, "name": f.name, "level": f.level,
            "total_desks": f.total_desks,
            "meeting_rooms": f.meeting_rooms or [],
        }
        for f in floors
    ]

    allocation_map = {a.team_id: a.floor_id for a in allocs}
    weights = {
        "collaboration": 1.0, "space_utilization": 1.0,
        "meeting_rooms": 1.0, "constraints": 2.0, "floor_preference": 0.5,
    }
    score, breakdown = score_allocation(allocation_map, teams_data, floors_data, weights)

    scenario = db.get(Scenario, scenario_id)
    scenario.score = score
    scenario.score_breakdown = breakdown
    db.commit()


# ── Serve React frontend ──────────────────────────────────────────────────────

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
