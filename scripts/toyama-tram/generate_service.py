"""Generate a compact live-service timetable from the same Toyama GTFS as replay."""

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from zipfile import ZipFile

from tram_data import _active_services, _rows, read_schedule


def generate_service(schedule_zip):
    with ZipFile(schedule_zip) as archive:
        info = next(_rows(archive, "feed_info"))
        start = datetime.strptime(info["feed_start_date"], "%Y%m%d").date()
        end = datetime.strptime(info["feed_end_date"], "%Y%m%d").date()
        # Resolve calendar and calendar_dates using the same rules as saved replays.
        # Deduplicate identical timetables across weekdays, weekends and holidays.
        service_days = {}
        day_types = []
        day = start
        while day <= end:
            services = tuple(sorted(_active_services(archive, day)))
            if services not in service_days:
                service_days[services] = (len(service_days), day)
            day_types.append(service_days[services][0])
            day += timedelta(days=1)

    timetables = []
    for _, first_day in service_days.values():
        schedule = read_schedule(schedule_zip, first_day)
        timetables.append(schedule["trips"])
    return {
        "startDate": start.isoformat(), "endDate": end.isoformat(),
        "dayTypes": day_types, "timetables": timetables,
        "stops": schedule["stops"], "shape": schedule["shape"], "sources": schedule["sources"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("schedule_zip", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = generate_service(args.schedule_zip)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
