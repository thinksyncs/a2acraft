"use strict";

function clockSeconds(value) {
  const [h, m, s] = value.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

function scenarioTimes(schedule, delay, multiplier) {
  return schedule.map(time => schedule[0] + delay + (time - schedule[0]) * multiplier);
}

function lineGeometry(stops, shape) {
  const lonScale = 111320 * Math.cos(stops[0].lat * Math.PI / 180);
  const meterPoint = (lat, lon) => [(lon - stops[0].lon) * lonScale, (lat - stops[0].lat) * 111320];
  const points = shape.map(pair => meterPoint(...pair));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]));
  }
  function nearest(point) {
    let best = {distance: Infinity, offset: 0};
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) continue;
      const fraction = Math.max(0, Math.min(1, ((point[0]-a[0])*dx + (point[1]-a[1])*dy) / lengthSquared));
      const distance = Math.hypot(point[0] - (a[0] + fraction * dx), point[1] - (a[1] + fraction * dy));
      if (distance < best.distance) best = {distance, offset: lengths[i-1] + fraction * Math.sqrt(lengthSquared)};
    }
    return best;
  }
  function at(offset) {
    const i = lengths.findIndex(value => value >= offset);
    if (i === 0) return points[0];
    if (i < 0) return points[points.length - 1];
    const fraction = (offset - lengths[i-1]) / (lengths[i] - lengths[i-1]);
    return points[i-1].map((p, axis) => p + fraction * (points[i][axis] - p));
  }
  const offsets = stops.map(stop => nearest(meterPoint(stop.lat, stop.lon)).offset);
  return {meterPoint, points, offsets, nearest, at};
}

function movement(seconds, times, offsets) {
  if (seconds < times[0]) return {offset: offsets[0], phase: "waiting", stop: 0};
  for (let i = 1; i < times.length; i++) {
    if (seconds < times[i]) {
      const fraction = (seconds - times[i-1]) / (times[i] - times[i-1]);
      return {offset: offsets[i-1] + fraction * (offsets[i] - offsets[i-1]), phase: "moving", stop: i};
    }
  }
  return {offset: offsets[offsets.length-1], phase: "arrived", stop: offsets.length-1};
}

function latestObservation(observations, tripId, epoch) {
  let latest = null;
  for (const sample of observations) {
    if (sample.tripId === tripId && sample.timestamp <= epoch && (!latest || sample.timestamp > latest.timestamp)) latest = sample;
  }
  return latest;
}

export {clockSeconds, scenarioTimes, lineGeometry, movement, latestObservation};
