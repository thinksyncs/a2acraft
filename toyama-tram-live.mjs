// GTFS-Realtime fields used here are defined in transit_realtime.proto.
const POSITIONS_URL = 'https://gtfs-rt-files.buscatch.jp/toyama/chitetsu_tram/VehiclePositions.pb';
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 15_000;
const DAY_MS = 86_400_000;
const JST_OFFSET = 9 * 3_600_000;
const text = new TextDecoder('utf-8', { fatal: true });

function* fields(bytes) {
  let cursor = 0;
  function varint() {
    let n = 0;
    for (let i = 0; i < 10 && cursor < bytes.length; i++) {
      const byte = bytes[cursor++];
      if (i === 9 && byte > 1) break;
      n += (byte & 127) * 2 ** (i * 7);
      if (byte < 128) return n;
    }
    throw new Error('Invalid protobuf integer');
  }
  while (cursor < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field < 1 || field >= 2 ** 29) throw new Error('Invalid protobuf tag');
    if (wire === 0) {
      yield [field, wire, varint()];
      continue;
    }
    let length;
    if (wire === 2) length = varint();
    else if (wire === 1) length = 8;
    else if (wire === 5) length = 4;
    else throw new Error('Unsupported protobuf wire type');
    if (length > bytes.length - cursor) throw new Error('Truncated protobuf input');
    const value = bytes.subarray(cursor, cursor + length);
    cursor += length;
    yield [field, wire, value];
  }
}

function message(bytes) {
  const values = new Map();
  for (const [field, wire, value] of fields(bytes)) values.set(field * 8 + wire, value);
  return (field, wire) => values.get(field * 8 + wire);
}

function float32(bytes) {
  if (!bytes) return NaN;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(0, true);
}

function readVehicle(raw) {
  const entity = message(raw);
  if (entity(2, 0) || !entity(4, 2)) return null;
  const vehicle = message(entity(4, 2));
  if (!vehicle(1, 2) || !vehicle(2, 2)) return null;
  const trip = message(vehicle(1, 2));
  const point = message(vehicle(2, 2));
  const timestamp = vehicle(5, 0);
  const lat = float32(point(1, 5));
  const lon = float32(point(2, 5));
  if (!trip(1, 2) || !Number.isSafeInteger(timestamp) || timestamp <= 0
      || !(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return {
    tripId: text.decode(trip(1, 2)), startDate: text.decode(trip(3, 2)), lat, lon, timestamp,
  };
}

function decodePositions(bytes) {
  let feedTimestamp;
  const observations = [];
  for (const [field, wire, value] of fields(bytes)) {
    if (wire !== 2) continue;
    if (field === 1) {
      const header = message(value);
      if (!header(1, 2) || header(2, 0)) throw new Error('Expected a full vehicle feed');
      feedTimestamp = header(3, 0);
    } else if (field === 2) {
      const sample = readVehicle(value);
      if (sample) observations.push(sample);
    }
  }
  if (!Number.isSafeInteger(feedTimestamp) || feedTimestamp <= 0) throw new Error('Missing timestamp');
  return {feedTimestamp, observations};
}

function joinTimetable(service, feed, currentMs) {
  const age = currentMs - feed.feedTimestamp * 1000;
  if (age > 300_000 || age < -60_000) throw new Error('車両位置の配信時刻を確認できません。');
  const day = Math.floor((feed.feedTimestamp * 1000 + JST_OFFSET) / DAY_MS);
  const serviceDate = new Date(day * DAY_MS).toISOString().slice(0, 10);
  const index = day - Date.parse(service.startDate) / DAY_MS;
  const trips = service.timetables[service.dayTypes[index]];
  if (!trips || serviceDate > service.endDate) throw new Error('公開時刻表の有効期間外です。');
  const ids = new Set(trips.map(trip => trip.id));
  const dateKey = serviceDate.replaceAll('-', '');
  const observations = [];
  for (const {tripId, startDate, lat, lon, timestamp} of feed.observations) {
    if (!ids.has(tripId) || (startDate && startDate !== dateKey)) continue;
    if (Math.floor((timestamp * 1000 + JST_OFFSET) / DAY_MS) !== day) continue;
    if (timestamp > feed.feedTimestamp + 30) continue;
    observations.push({tripId, lat, lon, timestamp});
  }
  return {
    stops: service.stops, shape: service.shape, trips, serviceDate, sources: service.sources,
    feedTimestamp: feed.feedTimestamp, observations,
  };
}

async function readFeed(fetchImpl) {
  const response = await fetchImpl(POSITIONS_URL, {signal: AbortSignal.timeout(8000), redirect: 'error'});
  if (!response.ok || !response.body) throw new Error('Vehicle feed unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEED_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Vehicle feed size limit exceeded');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodePositions(bytes);
}

// Share one request between clients. Keep upstream URLs fixed regardless of caller input.
export function createTramLiveHandler({loadSchedule, fetchImpl = fetch, now = Date.now}) {
  let pending;
  let expiresAt = 0;
  async function refresh() {
    try {
      const [service, feed] = await Promise.all([loadSchedule(), readFeed(fetchImpl)]);
      return {status: 200, body: joinTimetable(service, feed, now())};
    } catch (error) {
      const known = ['公開時刻表の有効期間外です。', '車両位置の配信時刻を確認できません。'];
      const message = known.includes(error.message) ? error.message : '車両位置を取得できません。';
      return {status: 503, body: {error: message}};
    } finally {
      expiresAt = now() + CACHE_MS;
    }
  }
  return async function handleTramLive() {
    if (!pending || now() >= expiresAt) {
      expiresAt = Infinity;
      pending = refresh();
    }
    const {status, body} = await pending;
    return Response.json(body, {status, headers: {'Cache-Control': 'no-store'}});
  };
}
