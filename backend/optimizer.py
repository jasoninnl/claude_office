"""
Staff allocation optimizer using simulated annealing + greedy initialization.

Scoring (higher = better):
  - Collaboration: teams that must_be_with on same floor => +points
  - Proximity: teams that must_be_near within 1 floor => +points
  - Separation: teams that must_separate_from on different floors => +points
  - Space utilization: allocated desks / total desks per floor, penalize over/under
  - Meeting rooms: teams that need meeting rooms get floors with enough capacity
  - Floor preference: team placed on preferred floor => +points
  - Constraint hard violations: must_be_with broken => heavy penalty
"""

import math
import random
from typing import List, Dict, Tuple, Optional


def _desks_needed(team: dict) -> int:
    return team["required_desks"] if team["required_desks"] > 0 else team["headcount"]


def score_allocation(
    allocation: Dict[int, int],  # team_id -> floor_id
    teams: List[dict],
    floors: List[dict],
    weights: dict,
) -> Tuple[float, dict]:
    floor_map = {f["id"]: f for f in floors}
    team_map = {t["id"]: t for t in teams}

    details = []
    collab_score = 0.0
    space_score = 0.0
    meeting_score = 0.0
    constraint_penalty = 0.0
    pref_score = 0.0

    # --- Collaboration & constraint scoring ---
    processed_pairs = set()
    for team in teams:
        tid = team["id"]
        fid = allocation.get(tid)
        if fid is None:
            continue

        floor = floor_map.get(fid, {})
        floor_level = floor.get("level", 0)

        # must_be_with (hard constraint -> heavy penalty if broken)
        for other_id in team.get("must_be_with", []):
            pair = tuple(sorted([tid, other_id]))
            if pair in processed_pairs:
                continue
            processed_pairs.add(pair)
            other_fid = allocation.get(other_id)
            if other_fid == fid:
                collab_score += 10.0
                details.append(f"✓ {team['name']} & {team_map.get(other_id, {}).get('name','?')} co-located")
            else:
                constraint_penalty += 20.0
                details.append(f"✗ VIOLATION: {team['name']} & {team_map.get(other_id, {}).get('name','?')} must be together")

        # must_be_near (soft constraint -> prefer within 1 floor)
        for other_id in team.get("must_be_near", []):
            pair = tuple(sorted([tid, other_id]))
            if pair in processed_pairs:
                continue
            processed_pairs.add(pair)
            other_fid = allocation.get(other_id)
            if other_fid is None:
                continue
            other_level = floor_map.get(other_fid, {}).get("level", 0)
            diff = abs(floor_level - other_level)
            if diff == 0:
                collab_score += 5.0
            elif diff == 1:
                collab_score += 3.0
            elif diff == 2:
                collab_score += 1.0
            # diff >= 3: no bonus

        # must_separate_from
        for other_id in team.get("must_separate_from", []):
            pair = tuple(sorted([tid, other_id]))
            if pair in processed_pairs:
                continue
            processed_pairs.add(pair)
            other_fid = allocation.get(other_id)
            if other_fid != fid:
                collab_score += 5.0
            else:
                constraint_penalty += 15.0
                details.append(f"✗ VIOLATION: {team['name']} & {team_map.get(other_id, {}).get('name','?')} must be separated")

        # Floor preference
        if team.get("floor_preference") is not None:
            if floor_level == team["floor_preference"]:
                pref_score += 5.0
            else:
                diff = abs(floor_level - team["floor_preference"])
                pref_score += max(0, 5.0 - diff * 2)

        # Meeting room requirements
        needed_rooms = team.get("meeting_rooms_needed", 0)
        min_cap = team.get("min_meeting_room_capacity", 0)
        if needed_rooms > 0 or min_cap > 0:
            rooms = floor.get("meeting_rooms", [])
            qualifying = [r for r in rooms if r.get("capacity", 0) >= max(min_cap, 1)]
            if len(qualifying) >= needed_rooms:
                meeting_score += 8.0
            else:
                shortfall = needed_rooms - len(qualifying)
                meeting_score -= shortfall * 5.0
                details.append(f"⚠ {team['name']} meeting room shortfall on {floor.get('name','?')}")

    # --- Space utilization per floor ---
    floor_desk_used: Dict[int, int] = {f["id"]: 0 for f in floors}
    for team in teams:
        tid = team["id"]
        fid = allocation.get(tid)
        if fid is not None:
            floor_desk_used[fid] = floor_desk_used.get(fid, 0) + _desks_needed(team)

    for floor in floors:
        fid = floor["id"]
        total = floor.get("total_desks", 0)
        used = floor_desk_used.get(fid, 0)
        if total <= 0:
            continue
        utilization = used / total
        if utilization > 1.0:
            # overcrowded - heavy penalty
            space_score -= (utilization - 1.0) * 30.0
            details.append(f"✗ OVERCROWDED: {floor['name']} at {utilization*100:.0f}%")
        elif utilization >= 0.6:
            space_score += utilization * 10.0  # sweet spot 60-100%
        elif utilization >= 0.3:
            space_score += utilization * 5.0
        else:
            space_score -= (0.3 - utilization) * 5.0  # too empty

    w = weights
    total = (
        w.get("collaboration", 1.0) * collab_score
        + w.get("space_utilization", 1.0) * space_score
        + w.get("meeting_rooms", 1.0) * meeting_score
        - w.get("constraints", 2.0) * constraint_penalty
        + w.get("floor_preference", 0.5) * pref_score
    )

    return total, {
        "total": round(total, 2),
        "collaboration": round(collab_score, 2),
        "space_utilization": round(space_score, 2),
        "meeting_rooms": round(meeting_score, 2),
        "constraint_violations": round(constraint_penalty, 2),
        "floor_preference": round(pref_score, 2),
        "details": details,
        "floor_utilization": {
            f["name"]: {
                "used": floor_desk_used[f["id"]],
                "total": f["total_desks"],
                "pct": round(floor_desk_used[f["id"]] / f["total_desks"] * 100, 1) if f["total_desks"] > 0 else 0,
            }
            for f in floors
        },
    }


def greedy_init(teams: List[dict], floors: List[dict]) -> Dict[int, int]:
    """Greedy initialization respecting must_be_with and capacity."""
    floor_remaining = {f["id"]: f.get("total_desks", 999) for f in floors}
    floors_sorted = sorted(floors, key=lambda f: f.get("total_desks", 0), reverse=True)
    allocation: Dict[int, int] = {}

    # First pass: place teams that have hard constraints together
    visited = set()
    groups: List[List[int]] = []
    team_map = {t["id"]: t for t in teams}

    for team in teams:
        tid = team["id"]
        if tid in visited:
            continue
        group = {tid}
        queue = list(team.get("must_be_with", []))
        while queue:
            nid = queue.pop()
            if nid in group or nid not in team_map:
                continue
            group.add(nid)
            queue.extend(team_map[nid].get("must_be_with", []))
        visited.update(group)
        groups.append(list(group))

    # Sort groups by total headcount desc
    groups.sort(key=lambda g: sum(_desks_needed(team_map[t]) for t in g if t in team_map), reverse=True)

    for group in groups:
        group_desks = sum(_desks_needed(team_map[t]) for t in group if t in team_map)
        # Find best floor with enough space
        best_floor = None
        for f in floors_sorted:
            if floor_remaining[f["id"]] >= group_desks:
                best_floor = f["id"]
                break
        if best_floor is None:
            # overflow: pick floor with most remaining space
            best_floor = max(floors_sorted, key=lambda f: floor_remaining[f["id"]])["id"]

        for tid in group:
            if tid in team_map:
                allocation[tid] = best_floor
                floor_remaining[best_floor] -= _desks_needed(team_map[tid])

    return allocation


def simulated_annealing(
    teams: List[dict],
    floors: List[dict],
    weights: dict,
    iterations: int = 5000,
    initial_temp: float = 50.0,
    cooling: float = 0.995,
    seed: Optional[int] = None,
) -> Tuple[Dict[int, int], float, dict]:
    if seed is not None:
        random.seed(seed)

    floor_ids = [f["id"] for f in floors]
    current = greedy_init(teams, floors)
    current_score, _ = score_allocation(current, teams, floors, weights)

    best = dict(current)
    best_score = current_score
    best_breakdown: dict = {}

    temp = initial_temp

    for i in range(iterations):
        # Randomly pick a team and move it to a different floor
        team = random.choice(teams)
        tid = team["id"]
        old_fid = current.get(tid)
        new_fid = random.choice([f for f in floor_ids if f != old_fid] or floor_ids)

        # Apply move
        candidate = dict(current)
        candidate[tid] = new_fid

        cand_score, cand_breakdown = score_allocation(candidate, teams, floors, weights)
        delta = cand_score - current_score

        if delta > 0 or random.random() < math.exp(delta / temp):
            current = candidate
            current_score = cand_score

        if current_score > best_score:
            best = dict(current)
            best_score = current_score
            best_breakdown = cand_breakdown

        temp *= cooling

    if not best_breakdown:
        _, best_breakdown = score_allocation(best, teams, floors, weights)

    return best, best_score, best_breakdown
