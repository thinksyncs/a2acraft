"""Read the Toyama tram timetable and GTFS-Realtime snapshots using the stdlib."""

import csv
import io
import math
import struct
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

SCHEDULE_URL = "https://api.gtfs-data.jp/v2/organizations/chitetsu/feeds/chitetsushinaidensha/files/feed.zip?rid=current"
POSITIONS_URL = "https://gtfs-rt-files.buscatch.jp/toyama/chitetsu_tram/VehiclePositions.pb"
CATALOG_URL = "https://gtfs-data.jp/search?target_feed=chitetsu%2Achitetsushinaidensha"
STOP_NAMES = ("南富山駅前", "大町", "堀川小泉")
JST = timezone(timedelta(hours=9))
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _varint(data, pos):
    result = 0
    for shift in range(0, 70, 7):
        if pos >= len(data):
            raise ValueError("GTFS-RT: truncated integer")
        byte = data[pos]
        pos += 1
        if shift == 63 and byte > 1:
            break
        result |= (byte & 127) << shift
        if byte < 128:
            return result, pos
    raise ValueError("GTFS-RT: invalid integer")


def _fields(data):
    """Yield field number, wire type and value without assuming field order."""
    pos = 0
    while pos < len(data):
        key, pos = _varint(data, pos)
        number, wire = key >> 3, key & 7
        if not 0 < number < 1 << 29:
            raise ValueError("GTFS-RT: invalid field number")
        if wire == 0:
            value, pos = _varint(data, pos)
        else:
            if wire == 2:
                size, pos = _varint(data, pos)
            elif wire in (1, 5):
                size = 8 if wire == 1 else 4
            else:
                raise ValueError("GTFS-RT: unsupported wire type")
            end = pos + size
            if end > len(data):
                raise ValueError("GTFS-RT: truncated field")
            value = data[pos:end]
            pos = end
        yield number, wire, value


def _message(data):
    return {(number, wire): value for number, wire, value in _fields(data)}


def _measurement(raw):
    vehicle = _message(raw)
    trip = _message(vehicle.get((1, 2), b""))
    point = _message(vehicle.get((2, 2), b""))
    trip_id = trip.get((1, 2), b"").decode()
    timestamp = vehicle.get((5, 0))
    if not trip_id or not timestamp or (1, 5) not in point or (2, 5) not in point:
        return None
    lat = struct.unpack("<f", point[1, 5])[0]
    lon = struct.unpack("<f", point[2, 5])[0]
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {
        "tripId": trip_id, "lat": lat, "lon": lon, "timestamp": timestamp,
        "startDate": trip.get((3, 2), b"").decode("ascii"),
    }


def decode_positions(raw):
    """Return (feed epoch seconds, timestamped vehicle observations)."""
    if len(raw) > 8_000_000:
        raise ValueError("GTFS-RT: feed too large")
    header = {}
    observations = []
    for number, wire, value in _fields(raw):
        if wire != 2:
            continue
        if number == 1:
            header = _message(value)
        elif number == 2:
            entity = _message(value)
            if (4, 2) in entity and not entity.get((2, 0), 0):
                measurement = _measurement(entity[4, 2])
                if measurement:
                    observations.append(measurement)
    timestamp = header.get((3, 0))
    if not timestamp or not header.get((1, 2)):
        raise ValueError("GTFS-RT: feed header is missing its timestamp or version")
    if header.get((2, 0), 0) != 0:
        raise ValueError("GTFS-RT: a full vehicle feed is required")
    # Out-of-range epoch values are malformed even if all entities are empty.
    try:
        datetime.fromtimestamp(timestamp, JST)
    except (OverflowError, ValueError, OSError) as err:
        raise ValueError("GTFS-RT: invalid feed timestamp") from err
    return timestamp, observations


def _rows(archive, table):
    member = archive.getinfo(table + ".txt")
    if member.file_size > 32_000_000:
        raise ValueError("GTFS table too large: " + table)
    with archive.open(member) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))


def _active_services(archive, day):
    key = day.strftime("%Y%m%d")
    services = set()
    if "calendar.txt" in archive.namelist():
        for row in _rows(archive, "calendar"):
            if row["start_date"] <= key <= row["end_date"] and row[WEEKDAYS[day.weekday()]] == "1":
                services.add(row["service_id"])
    if "calendar_dates.txt" in archive.namelist():
        for row in _rows(archive, "calendar_dates"):
            if row["date"] == key:
                if row["exception_type"] == "1":
                    services.add(row["service_id"])
                elif row["exception_type"] == "2":
                    services.discard(row["service_id"])
    return services


def _coord(row):
    return [float(row["shape_pt_lat"]), float(row["shape_pt_lon"])]


def _clipped_shape(archive, shape_id, stops):
    rows = (row for row in _rows(archive, "shapes") if row["shape_id"] == shape_id)
    points = [_coord(row) for row in sorted(rows, key=lambda row: int(row["shape_pt_sequence"]))]
    if not points:
        raise ValueError("GTFS: missing route shape")
    start = 0
    indexes = []
    for stop in stops:
        # The three stop coordinates also occur as vertices in the operator shape.
        start = min(range(start, len(points)), key=lambda i:
                    (points[i][0] - stop["lat"])**2 +
                    ((points[i][1] - stop["lon"]) * math.cos(math.radians(stop["lat"])))**2)
        indexes.append(start)
    if len(set(indexes)) != len(stops):
        raise ValueError("GTFS: stops do not match distinct shape vertices")
    return points[indexes[0]:indexes[-1] + 1]


def time_seconds(value):
    hours, minutes, seconds = map(int, value.split(":"))
    return hours * 3600 + minutes * 60 + seconds


def read_schedule(path, day):
    """Read just the three consecutive stops in the requested direction on day."""
    with zipfile.ZipFile(path) as archive:
        services = _active_services(archive, day)
        stops_by_id = {row["stop_id"]: row for row in _rows(archive, "stops")}
        routes = {row["trip_id"]: row for row in _rows(archive, "trips")}
        calls = defaultdict(list)
        for row in _rows(archive, "stop_times"):
            calls[row["trip_id"]].append(row)

        trips = []
        stop_ids = None
        shape_id = None
        for trip_id, rows in calls.items():
            rows.sort(key=lambda r: int(r["stop_sequence"]))
            names = [stops_by_id[row["stop_id"]]["stop_name"] for row in rows]
            for i, name in enumerate(names):
                if name != STOP_NAMES[0] or tuple(names[i:i+3]) != STOP_NAMES:
                    continue
                segment = rows[i:i+3]
                route = routes[trip_id]
                if stop_ids is None:
                    stop_ids = [row["stop_id"] for row in segment]
                    shape_id = route["shape_id"]
                if route["service_id"] in services:
                    trips.append({
                        "id": trip_id,
                        "times": [segment[0]["departure_time"], segment[1]["arrival_time"], segment[2]["arrival_time"]],
                    })
                break

        if not stop_ids:
            raise ValueError("GTFS: no matching three-stop segment")
        stops = [{"name": stops_by_id[s]["stop_name"], "lat": float(stops_by_id[s]["stop_lat"]),
                  "lon": float(stops_by_id[s]["stop_lon"])} for s in stop_ids]
        shape = _clipped_shape(archive, shape_id, stops)
    return {
        "stops": stops, "shape": shape, "trips": sorted(trips, key=lambda t: time_seconds(t["times"][0])),
        "observations": [], "serviceDate": day.isoformat(),
        "sources": {"operator": "富山地方鉄道", "catalog": CATALOG_URL, "schedule": SCHEDULE_URL,
                    "positions": POSITIONS_URL, "license": "CC0 1.0"},
    }


def match_observations(schedule, observations):
    """Require the trip ID and service date to match scheduled service."""
    service_date = datetime.fromisoformat(schedule["serviceDate"]).date()
    trips = {trip["id"]: trip for trip in schedule["trips"]}
    matched = []
    for observation in observations:
        trip = trips.get(observation["tripId"])
        if trip is None:
            continue
        try:
            observed_day = datetime.fromtimestamp(observation["timestamp"], JST).date()
        except (OverflowError, OSError, ValueError):
            continue
        # In this corridor all trips finish before midnight. Still accept a
        # next-day point for a timetable explicitly using hours >= 24.
        day_offset = (observed_day - service_date).days
        if not 0 <= day_offset <= time_seconds(trip["times"][-1]) // 86400:
            continue
        if observation["startDate"] and observation["startDate"] != service_date.strftime("%Y%m%d"):
            continue
        matched.append({k: observation[k] for k in ("tripId", "lat", "lon", "timestamp")})
    return matched
