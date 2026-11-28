import io
import json
import struct
import unittest
import zipfile
from datetime import date, datetime
from pathlib import Path

from make_sample import in_corridor
from tram_data import JST, STOP_NAMES, _active_services, decode_positions, match_observations


def varint(value):
    raw = bytearray()
    while value >= 128:
        raw.append(128 | (value & 127))
        value >>= 7
    raw.append(value)
    return bytes(raw)


def message(number, data):
    return varint(number << 3 | 2) + varint(len(data)) + data


class DataTest(unittest.TestCase):
    def test_exception_overrides_weekly_calendar(self):
        with zipfile.ZipFile(io.BytesIO(), "w") as archive:
            archive.writestr("calendar.txt", "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nregular,1,1,1,1,1,1,1,20260101,20261231\n")
            archive.writestr("calendar_dates.txt", "service_id,date,exception_type\nregular,20261128,2\nholiday,20261128,1\n")
            self.assertEqual(_active_services(archive, date(2026, 11, 28)), {"holiday"})
            self.assertEqual(_active_services(archive, date(2026, 11, 29)), {"regular"})

    def test_timestamp_is_the_observation_time(self):
        header = message(1, b"2.0") + b"\x18" + varint(200)
        point = b"\r" + struct.pack("<f", 36.67) + b"\x15" + struct.pack("<f", 137.22)
        body = message(1, message(1, b"run1")) + message(2, point)
        vehicle = message(4, body + b"\x28" + varint(100))
        feed = message(2, vehicle) + message(1, header)
        timestamp, positions = decode_positions(feed)
        self.assertEqual(timestamp, 200)
        self.assertEqual(positions[0]["timestamp"], 100)
        self.assertEqual(positions[0]["tripId"], "run1")
        self.assertEqual(decode_positions(message(1, header) + message(2, message(4, body)))[1], [])

    def test_reject_damaged_feed(self):
        for invalid in (b"", b"\0", b"\x12\x7fabc", b"\x80"*12):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                decode_positions(invalid)

    def test_service_day_and_trip_must_both_match(self):
        day = "2026-11-28"
        schedule = {"serviceDate": day, "trips": [{"id": "run", "times": ["08:00:00", "08:02:00"]}]}
        t = int(datetime(2026, 11, 28, 8, tzinfo=JST).timestamp())
        reading = {"tripId": "run", "startDate": "", "lat": 36.67, "lon": 137.22, "timestamp": t}
        rows = [reading, {**reading, "tripId": "other"}, {**reading, "startDate": "20261127"},
                {**reading, "timestamp": t - 86400}]
        matched = match_observations(schedule, rows)
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["timestamp"], t)

    def test_bundled_replay_integrity(self):
        sample = Path(__file__).resolve().parents[2] / "public/toyama-tram/data/replay.json"
        data = json.loads(sample.read_text(encoding="utf-8"))
        self.assertEqual(tuple(s["name"] for s in data["stops"]), STOP_NAMES)
        trips = {trip["id"] for trip in data["trips"]}
        rows = data["observations"]
        self.assertGreaterEqual(len(rows), 2)
        self.assertIn(data["replayTripId"], trips)
        self.assertTrue(all(row["tripId"] == data["replayTripId"] for row in rows))
        self.assertTrue(all(in_corridor(row, data["shape"]) for row in rows))
        self.assertEqual([r["timestamp"] for r in rows], sorted({r["timestamp"] for r in rows}))
        for row in rows:
            self.assertEqual(datetime.fromtimestamp(row["timestamp"], JST).date().isoformat(), data["serviceDate"])


if __name__ == "__main__":
    unittest.main()
