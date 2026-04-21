from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, selectinload
from typing import List

from database import engine, get_db
from models import Base, Floor, Team, Scenario, Allocation
from schemas import (
    FloorCreate, FloorUpdate, FloorOut,
    TeamCreate, TeamUpdate, TeamOut,
    ScenarioCreate, ScenarioUpdate, ScenarioOut,
    AllocationItem, OptimizeRequest,
)
from optimizer import simulated_annealing, score_allocation

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Office Staff Allocation Optimizer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
