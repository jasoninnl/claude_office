from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session, selectinload
from typing import List, Optional
from pathlib import Path
from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
import uuid

import jwt

from database import engine, get_db
from models import Base, Floor, Team, Scenario, Allocation, FloorElement, ScenarioElementAssignment
from schemas import (
    FloorCreate, FloorUpdate, FloorOut,
    TeamCreate, TeamUpdate, TeamOut,
    ScenarioCreate, ScenarioUpdate, ScenarioOut,
    AllocationItem, AllocationOut, AllocationPositionUpdate, OptimizeRequest,
    FloorElementOut, FloorElementPatch, FloorElementCreate,
    BulkAssignRequest, AutoAssignRequest, PDFParseResult, LoginRequest,
)
from optimizer import simulated_annealing, score_allocation

Base.metadata.create_all(bind=engine)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", Path(__file__).parent / "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ── Auth config ──────────────────────────────────────────────────────────────
APP_USERNAME = os.environ.get("APP_USERNAME", "admin")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
# Derive a stable secret from the password so tokens survive restarts.
# Set SECRET_KEY explicitly in production for best security.
_SECRET_KEY = os.environ.get("SECRET_KEY") or hashlib.sha256(
    (APP_PASSWORD or secrets.token_hex(32)).encode()
).hexdigest()
_ALGORITHM = "HS256"
_TOKEN_DAYS = 30

# API path prefixes that require a valid token
_PROTECTED = (
    "/floors", "/teams", "/scenarios", "/allocations",
    "/optimize", "/floor-elements",
)

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


# ── Auth middleware & login endpoint ─────────────────────────────────────────

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not any(request.url.path.startswith(p) for p in _PROTECTED):
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    try:
        payload = jwt.decode(auth[7:], _SECRET_KEY, algorithms=[_ALGORITHM])
        if payload.get("sub") != APP_USERNAME:
            raise jwt.InvalidTokenError()
    except jwt.InvalidTokenError:
        return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
    return await call_next(request)


@app.post("/auth/login")
def login(body: LoginRequest):
    if not APP_PASSWORD:
        raise HTTPException(500, "APP_PASSWORD environment variable is not set")
    ok = (
        secrets.compare_digest(body.username, APP_USERNAME)
        and secrets.compare_digest(body.password, APP_PASSWORD)
    )
    if not ok:
        raise HTTPException(401, "Invalid username or password")
    token = jwt.encode(
        {"sub": APP_USERNAME, "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_DAYS)},
        _SECRET_KEY,
        algorithm=_ALGORITHM,
    )
    return {"access_token": token, "token_type": "bearer"}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _sync_floor_counts(db: Session, floor_id: int):
    """Sync floor.total_desks, floor.meeting_rooms, and allocation.desks_used from FloorElement data."""
    floor = db.get(Floor, floor_id)
    if not floor:
        return

    desks = db.query(FloorElement).filter(
        FloorElement.floor_id == floor_id,
        FloorElement.element_type == "desk",
    ).all()

    floor.total_desks = len(desks)

    # Sync meeting_rooms list — preserve existing capacities by matching on name
    mr_elements = db.query(FloorElement).filter(
        FloorElement.floor_id == floor_id,
        FloorElement.element_type == "meeting_room",
    ).order_by(FloorElement.y, FloorElement.x).all()

    capacity_by_name: dict = {
        r["name"]: r.get("capacity", 0) for r in (floor.meeting_rooms or [])
    }
    new_rooms = []
    for i, el in enumerate(mr_elements, 1):
        name = el.label if el.label else f"Meeting Room {i}"
        new_rooms.append({"name": name, "capacity": capacity_by_name.get(name, 0)})
    floor.meeting_rooms = new_rooms

    # Sync allocation.desks_used per scenario using ScenarioElementAssignment
    desk_ids = [d.id for d in desks]
    allocs = db.query(Allocation).filter(Allocation.floor_id == floor_id).all()
    for alloc in allocs:
        if not desk_ids:
            alloc.desks_used = 0
        else:
            alloc.desks_used = db.query(ScenarioElementAssignment).filter(
                ScenarioElementAssignment.scenario_id == alloc.scenario_id,
                ScenarioElementAssignment.element_id.in_(desk_ids),
                ScenarioElementAssignment.team_id == alloc.team_id,
            ).count()

    db.commit()


def _upsert_scenario_assignment(
    db: Session, scenario_id: int, element_id: int,
    team_id_set: bool, team_id: Optional[int], is_lead_office: Optional[bool],
) -> None:
    """Create or update a per-scenario element assignment."""
    sa = (
        db.query(ScenarioElementAssignment)
        .filter_by(scenario_id=scenario_id, element_id=element_id)
        .first()
    )
    if sa:
        if team_id_set:
            sa.team_id = team_id
        if is_lead_office is not None:
            sa.is_lead_office = is_lead_office
    else:
        db.add(ScenarioElementAssignment(
            scenario_id=scenario_id,
            element_id=element_id,
            team_id=team_id if team_id_set else None,
            is_lead_office=is_lead_office or False,
        ))


def _overlay_scenario_assignments(
    db: Session, elements: list, scenario_id: Optional[int]
) -> list:
    """Overlay per-scenario team assignments onto FloorElement objects in-memory.

    Because autoflush=False and no commit is issued in read endpoints, these
    in-memory mutations are never persisted to the database.
    """
    if not scenario_id or not elements:
        return elements

    element_ids = [el.id for el in elements]
    assign_map: dict = {}
    for a in (
        db.query(ScenarioElementAssignment)
        .options(selectinload(ScenarioElementAssignment.team))
        .filter(
            ScenarioElementAssignment.scenario_id == scenario_id,
            ScenarioElementAssignment.element_id.in_(element_ids),
        )
        .all()
    ):
        assign_map[a.element_id] = a

    for el in elements:
        if el.id in assign_map:
            a = assign_map[el.id]
            el.team_id = a.team_id
            el.is_lead_office = a.is_lead_office
            el.team = a.team
        else:
            el.team_id = None
            el.is_lead_office = False
            el.team = None

    return elements


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


# ── PDF Upload & Element Detection ──────────────────────────────────────────

@app.post("/floors/{floor_id}/pdf", response_model=PDFParseResult)
async def upload_floor_pdf(
    floor_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    try:
        from pdf_parser import process_pdf
    except ImportError:
        raise HTTPException(500, "PyMuPDF is not installed. Run: pip install pymupdf")

    # Save PDF
    pdf_name = f"floor_{floor_id}_{uuid.uuid4().hex[:8]}.pdf"
    pdf_dest = UPLOAD_DIR / pdf_name
    content = await file.read()
    pdf_dest.write_bytes(content)

    # Remove old PDF and PNG
    for old_path in [floor.pdf_path, floor.image_path]:
        if old_path:
            old = UPLOAD_DIR / Path(old_path).name
            if old.exists():
                old.unlink()

    result = process_pdf(pdf_dest)

    # Save rasterised PNG as the floor image
    img_name = f"floor_{floor_id}_{uuid.uuid4().hex[:8]}.png"
    img_dest = UPLOAD_DIR / img_name
    img_dest.write_bytes(result["image_bytes"])

    floor.pdf_path = f"/uploads/{pdf_name}"
    floor.image_path = f"/uploads/{img_name}"
    floor.pdf_page_width = result["pdf_page_width"]
    floor.pdf_page_height = result["pdf_page_height"]

    # Replace all existing elements
    db.query(FloorElement).filter(FloorElement.floor_id == floor_id).delete()
    for el in result["elements"]:
        db.add(FloorElement(
            floor_id=floor_id,
            element_type=el["element_type"],
            x=el["x"], y=el["y"], w=el["w"], h=el["h"],
            nx=el["nx"], ny=el["ny"], nw=el["nw"], nh=el["nh"],
            label=el["label"],
            confidence=el["confidence"],
        ))

    db.commit()
    _sync_floor_counts(db, floor_id)
    return PDFParseResult(
        desk_count=result["desk_count"],
        office_count=result["office_count"],
        warnings=result["warnings"],
    )


@app.delete("/floors/{floor_id}/pdf", response_model=FloorOut)
def delete_floor_pdf(floor_id: int, db: Session = Depends(get_db)):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    for path in [floor.pdf_path, floor.image_path]:
        if path:
            p = UPLOAD_DIR / Path(path).name
            if p.exists():
                p.unlink()
    floor.pdf_path = None
    floor.image_path = None
    floor.pdf_page_width = None
    floor.pdf_page_height = None
    db.query(FloorElement).filter(FloorElement.floor_id == floor_id).delete()
    db.commit()
    db.refresh(floor)
    return floor


# ── Floor Elements CRUD ──────────────────────────────────────────────────────

@app.get("/floors/{floor_id}/elements", response_model=List[FloorElementOut])
def list_elements(
    floor_id: int,
    element_type: Optional[str] = None,
    scenario_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(FloorElement).options(
        selectinload(FloorElement.team)
    ).filter(FloorElement.floor_id == floor_id)
    if element_type:
        q = q.filter(FloorElement.element_type == element_type)
    elements = q.order_by(FloorElement.y, FloorElement.x).all()
    return _overlay_scenario_assignments(db, elements, scenario_id)


@app.post("/floors/{floor_id}/elements", response_model=FloorElementOut)
def add_element(
    floor_id: int,
    body: FloorElementCreate,
    db: Session = Depends(get_db),
):
    floor = db.get(Floor, floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    pw = floor.pdf_page_width or 841
    ph = floor.pdf_page_height or 595
    el = FloorElement(
        floor_id=floor_id,
        element_type=body.element_type,
        nx=body.nx, ny=body.ny, nw=body.nw, nh=body.nh,
        x=body.nx * pw, y=body.ny * ph,
        w=body.nw * pw, h=body.nh * ph,
        label=body.label,
        confidence=1.0,
    )
    db.add(el)
    db.commit()
    db.refresh(el)
    _sync_floor_counts(db, floor_id)
    return db.query(FloorElement).options(selectinload(FloorElement.team)).filter(FloorElement.id == el.id).first()


@app.patch("/floor-elements/{element_id}", response_model=FloorElementOut)
def patch_element(
    element_id: int,
    body: FloorElementPatch,
    db: Session = Depends(get_db),
):
    el = db.get(FloorElement, element_id)
    if not el:
        raise HTTPException(404, "Element not found")

    # Geometry / type / label — always on FloorElement (scenario-agnostic)
    if body.element_type is not None:
        el.element_type = body.element_type
    if body.label is not None:
        el.label = body.label
    floor_id = el.floor_id
    floor = db.get(Floor, floor_id)
    pw = floor.pdf_page_width if floor else 841
    ph = floor.pdf_page_height if floor else 595
    if body.nx is not None:
        el.nx = body.nx; el.x = body.nx * pw
    if body.ny is not None:
        el.ny = body.ny; el.y = body.ny * ph
    if body.nw is not None:
        el.nw = body.nw; el.w = body.nw * pw
    if body.nh is not None:
        el.nh = body.nh; el.h = body.nh * ph

    # Team assignment — scenario-specific when scenario_id provided
    team_id_in_request = "team_id" in body.model_fields_set
    if body.scenario_id and (team_id_in_request or body.is_lead_office is not None):
        _upsert_scenario_assignment(
            db, body.scenario_id, element_id,
            team_id_set=team_id_in_request,
            team_id=body.team_id,
            is_lead_office=body.is_lead_office,
        )
    else:
        if body.team_id is not None:
            el.team_id = body.team_id
        elif team_id_in_request:
            el.team_id = None
        if body.is_lead_office is not None:
            el.is_lead_office = body.is_lead_office

    db.commit()
    _sync_floor_counts(db, floor_id)

    base = db.query(FloorElement).options(selectinload(FloorElement.team)).filter(FloorElement.id == element_id).first()
    result = _overlay_scenario_assignments(db, [base], body.scenario_id)
    return result[0]


@app.delete("/floor-elements/{element_id}")
def delete_element(element_id: int, db: Session = Depends(get_db)):
    el = db.get(FloorElement, element_id)
    if not el:
        raise HTTPException(404, "Element not found")
    floor_id = el.floor_id
    db.delete(el)
    db.commit()
    _sync_floor_counts(db, floor_id)
    return {"ok": True}


@app.post("/floors/{floor_id}/elements/bulk-assign", response_model=List[FloorElementOut])
def bulk_assign(
    floor_id: int,
    body: BulkAssignRequest,
    db: Session = Depends(get_db),
):
    elements = db.query(FloorElement).filter(
        FloorElement.floor_id == floor_id,
        FloorElement.id.in_(body.element_ids),
    ).all()
    if body.scenario_id:
        for el in elements:
            _upsert_scenario_assignment(
                db, body.scenario_id, el.id,
                team_id_set=True, team_id=body.team_id,
                is_lead_office=False if body.team_id is None else None,
            )
    else:
        for el in elements:
            el.team_id = body.team_id
            if body.team_id is None:
                el.is_lead_office = False
    db.commit()
    _sync_floor_counts(db, floor_id)
    refreshed = db.query(FloorElement).options(selectinload(FloorElement.team)).filter(
        FloorElement.id.in_(body.element_ids)
    ).all()
    return _overlay_scenario_assignments(db, refreshed, body.scenario_id)


@app.post("/floors/{floor_id}/auto-assign", response_model=List[FloorElementOut])
def auto_assign_floor(
    floor_id: int,
    body: AutoAssignRequest,
    db: Session = Depends(get_db),
):
    from pdf_parser import auto_assign

    allocs = (
        db.query(Allocation)
        .options(selectinload(Allocation.team))
        .filter(
            Allocation.floor_id == floor_id,
            Allocation.scenario_id == body.scenario_id,
        )
        .all()
    )
    if not allocs:
        raise HTTPException(400, "No teams are allocated to this floor in the selected scenario")

    desks = db.query(FloorElement).filter(
        FloorElement.floor_id == floor_id,
        FloorElement.element_type == "desk",
    ).all()
    offices = db.query(FloorElement).filter(
        FloorElement.floor_id == floor_id,
        FloorElement.element_type == "office",
    ).all()

    # Save original FloorElement state (auto_assign mutates these in-memory)
    orig_state = {el.id: {"team_id": el.team_id, "is_lead_office": el.is_lead_office}
                  for el in desks + offices}

    auto_assign(desks, offices, allocs)

    # Write results to ScenarioElementAssignment (scenario-specific)
    for el in desks + offices:
        _upsert_scenario_assignment(
            db, body.scenario_id, el.id,
            team_id_set=True, team_id=el.team_id,
            is_lead_office=el.is_lead_office,
        )

    # Restore FloorElement.team_id/is_lead_office so they aren't persisted globally.
    # Label changes (lead office names) are kept as they're display metadata.
    for el in desks + offices:
        el.team_id = orig_state[el.id]["team_id"]
        el.is_lead_office = orig_state[el.id]["is_lead_office"]

    db.commit()
    _sync_floor_counts(db, floor_id)

    all_elements = db.query(FloorElement).options(selectinload(FloorElement.team)).filter(
        FloorElement.floor_id == floor_id
    ).order_by(FloorElement.y, FloorElement.x).all()
    return _overlay_scenario_assignments(db, all_elements, body.scenario_id)


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

    # Copy per-element assignments so the duplicate retains the same desk layout
    src_assignments = db.query(ScenarioElementAssignment).filter(
        ScenarioElementAssignment.scenario_id == scenario_id
    ).all()
    for a in src_assignments:
        db.add(ScenarioElementAssignment(
            scenario_id=copy.id,
            element_id=a.element_id,
            team_id=a.team_id,
            is_lead_office=a.is_lead_office,
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
