"""Bundle real VehiclePositions snapshots for one outbound trip and service date."""

import argparse
import json
import math
from datetime import date
from pathlib import Path

from tram_data import read_schedule, decode_positions, match_observations


def in_corridor(point, shape):
    """Accept readings within 55 metres of the clipped route, including both ends."""
    degree_latitude = 111_200
    degree_longitude = degree_latitude * math.cos(math.radians(point["lat"]))
    relative = [((lon - point["lon"]) * degree_longitude,
                 (lat - point["lat"]) * degree_latitude) for lat, lon in shape]
    for (x0, y0), (x1, y1) in zip(relative, relative[1:]):
        dx, dy = x1 - x0, y1 - y0
        length_squared = dx * dx + dy * dy
        t = max(0, min(1, -(x0 * dx + y0 * dy) / length_squared)) if length_squared else 0
        if math.hypot(x0 + t * dx, y0 + t * dy) <= 55:
            return True
    return False


def build_replay(schedule_zip, snapshots, day, trip_id):
    result = read_schedule(schedule_zip, day)
    if not any(trip["id"] == trip_id for trip in result["trips"]):
        raise ValueError("Trip is absent from this service date")
    recorded = {}
    for path in snapshots:
        _, observations = decode_positions(path.read_bytes())
        for row in match_observations(result, observations):
            if row["tripId"] == trip_id and in_corridor(row, result["shape"]):
                recorded[row["timestamp"]] = row
    if len(recorded) < 2:
        raise ValueError("Need at least two distinct vehicle measurement times in the corridor")
    result["observations"] = [recorded[time] for time in sorted(recorded)]
    result["replayTripId"] = trip_id
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schedule", required=True, type=Path)
    parser.add_argument("--date", required=True, type=date.fromisoformat)
    parser.add_argument("--trip", required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / "public/toyama-tram/data/replay.json")
    parser.add_argument("snapshots", type=Path, nargs="+")
    args = parser.parse_args()
    result = build_replay(args.schedule, args.snapshots, args.date, args.trip)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
