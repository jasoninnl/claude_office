"""Seed the database with sample office data."""
from database import engine, SessionLocal
from models import Base, Floor, Team, Scenario, Allocation

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# Clear existing data
db.query(Allocation).delete()
db.query(Scenario).delete()
db.query(Team).delete()
db.query(Floor).delete()
db.commit()

floors = [
    Floor(
        name="Ground Floor",
        level=1,
        total_desks=80,
        meeting_rooms=[
            {"name": "Boardroom", "capacity": 20},
            {"name": "Seminar A", "capacity": 12},
            {"name": "Seminar B", "capacity": 12},
            {"name": "Pod 1", "capacity": 4},
            {"name": "Pod 2", "capacity": 4},
        ],
        amenities=["Reception", "Cafeteria", "Presentation Suite"],
        notes="Client-facing floor with main entrance",
    ),
    Floor(
        name="First Floor",
        level=2,
        total_desks=100,
        meeting_rooms=[
            {"name": "Meeting 1A", "capacity": 10},
            {"name": "Meeting 1B", "capacity": 10},
            {"name": "Meeting 1C", "capacity": 8},
            {"name": "Focus Room 1", "capacity": 2},
            {"name": "Focus Room 2", "capacity": 2},
            {"name": "Focus Room 3", "capacity": 2},
        ],
        amenities=["Kitchen", "Phone Booths", "Collaboration Zone"],
        notes="Primary operations floor",
    ),
    Floor(
        name="Second Floor",
        level=3,
        total_desks=90,
        meeting_rooms=[
            {"name": "Meeting 2A", "capacity": 10},
            {"name": "Meeting 2B", "capacity": 8},
            {"name": "Meeting 2C", "capacity": 6},
            {"name": "Focus Room 4", "capacity": 2},
            {"name": "Focus Room 5", "capacity": 2},
        ],
        amenities=["Kitchen", "Quiet Zone", "Standing Desks"],
        notes="Engineering & technical teams",
    ),
    Floor(
        name="Third Floor",
        level=4,
        total_desks=70,
        meeting_rooms=[
            {"name": "Executive Suite", "capacity": 16},
            {"name": "Strategy Room", "capacity": 10},
            {"name": "Meeting 3A", "capacity": 8},
            {"name": "Meeting 3B", "capacity": 6},
        ],
        amenities=["Executive Lounge", "Rooftop Terrace", "Premium AV"],
        notes="Leadership & executive team floor",
    ),
]

db.add_all(floors)
db.commit()
for f in floors:
    db.refresh(f)

teams = [
    Team(name="Engineering", headcount=45, department="Technology", color="#3b82f6",
         meeting_rooms_needed=2, min_meeting_room_capacity=8,
         notes="Core engineering team, needs quiet focused space"),
    Team(name="Product", headcount=18, department="Technology", color="#8b5cf6",
         meeting_rooms_needed=2, min_meeting_room_capacity=6,
         notes="Works closely with Engineering and Design"),
    Team(name="Design", headcount=12, department="Technology", color="#ec4899",
         meeting_rooms_needed=1, min_meeting_room_capacity=6,
         notes="UX/UI team, collaboration with Product"),
    Team(name="Sales", headcount=30, department="Revenue", color="#f59e0b",
         meeting_rooms_needed=3, min_meeting_room_capacity=8,
         floor_preference=1,
         notes="Client meetings, needs ground floor access"),
    Team(name="Marketing", headcount=15, department="Revenue", color="#10b981",
         meeting_rooms_needed=1, min_meeting_room_capacity=8,
         notes="Works with Sales and Leadership"),
    Team(name="Finance", headcount=14, department="Operations", color="#6366f1",
         meeting_rooms_needed=1, min_meeting_room_capacity=6,
         notes="Needs quiet environment for focused work"),
    Team(name="HR", headcount=8, department="Operations", color="#14b8a6",
         meeting_rooms_needed=1, min_meeting_room_capacity=4,
         notes="Needs private meeting space for sensitive conversations"),
    Team(name="Leadership", headcount=10, department="Executive", color="#f97316",
         meeting_rooms_needed=2, min_meeting_room_capacity=10,
         floor_preference=4,
         notes="Executive team, prefers top floor"),
    Team(name="Customer Success", headcount=20, department="Revenue", color="#84cc16",
         meeting_rooms_needed=1, min_meeting_room_capacity=6,
         notes="Close collaboration with Sales"),
    Team(name="Legal & Compliance", headcount=6, department="Operations", color="#94a3b8",
         meeting_rooms_needed=1, min_meeting_room_capacity=6,
         notes="Needs confidential meeting facilities"),
]

db.add_all(teams)
db.commit()
for t in teams:
    db.refresh(t)

# Set up team relationships
team_map = {t.name: t for t in teams}

# Engineering + Product + Design work closely
eng = team_map["Engineering"]
prod = team_map["Product"]
des = team_map["Design"]
sales = team_map["Sales"]
cs = team_map["Customer Success"]
mkt = team_map["Marketing"]
leadership = team_map["Leadership"]
hr = team_map["HR"]
finance = team_map["Finance"]

eng.must_be_with = [prod.id]
prod.must_be_with = [eng.id]
prod.must_be_near = [des.id]
des.must_be_near = [prod.id]
sales.must_be_with = [cs.id]
cs.must_be_with = [sales.id]
sales.must_be_near = [mkt.id]
mkt.must_be_near = [sales.id]
finance.must_separate_from = [sales.id]

db.commit()

# Create a manual baseline scenario (unoptimized)
baseline = Scenario(name="Current Layout (Baseline)", description="Existing staff arrangement", is_baseline=True)
db.add(baseline)
db.commit()
db.refresh(baseline)

f1, f2, f3, f4 = floors[0].id, floors[1].id, floors[2].id, floors[3].id

baseline_allocs = [
    Allocation(scenario_id=baseline.id, team_id=team_map["Sales"].id, floor_id=f1, desks_used=30),
    Allocation(scenario_id=baseline.id, team_id=team_map["HR"].id, floor_id=f1, desks_used=8),
    Allocation(scenario_id=baseline.id, team_id=team_map["Engineering"].id, floor_id=f2, desks_used=45),
    Allocation(scenario_id=baseline.id, team_id=team_map["Finance"].id, floor_id=f2, desks_used=14),
    Allocation(scenario_id=baseline.id, team_id=team_map["Customer Success"].id, floor_id=f3, desks_used=20),
    Allocation(scenario_id=baseline.id, team_id=team_map["Product"].id, floor_id=f3, desks_used=18),
    Allocation(scenario_id=baseline.id, team_id=team_map["Design"].id, floor_id=f3, desks_used=12),
    Allocation(scenario_id=baseline.id, team_id=team_map["Marketing"].id, floor_id=f4, desks_used=15),
    Allocation(scenario_id=baseline.id, team_id=team_map["Leadership"].id, floor_id=f4, desks_used=10),
    Allocation(scenario_id=baseline.id, team_id=team_map["Legal & Compliance"].id, floor_id=f4, desks_used=6),
]
db.add_all(baseline_allocs)
db.commit()

print("Database seeded successfully.")
print(f"  Floors: {len(floors)}")
print(f"  Teams:  {len(teams)}")
print(f"  Scenarios: 1 (baseline)")
