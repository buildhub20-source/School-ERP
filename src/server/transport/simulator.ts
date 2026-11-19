import "server-only";
import { db } from "@/lib/db";
import { runWithContext } from "@/lib/context";
import { checkNearStops } from "./trips";

/**
 * MOCK GPS FEED (POC only, enabled with MOCK_GPS=true).
 *
 * Stands in for the drivers' phones: every few seconds each active bus that has a route is moved along its stops, exactly
 * as if the driver app were sending pings — BusLocation rows, Bus.lastLat/lastLng, and the near-stop automation (parents
 * get "Bus 3 is near Adyar Signal" in their app and the Outbox). The staff live map and the parent bus tracker therefore
 * move without any real device.
 *
 * Trips it opens are marked startedById = SIM. It never touches a trip a real driver started, and after a driver ends a
 * trip (simulated or their own) it leaves that bus alone for a while so the driver app can be demoed on it.
 */

export const SIM = "gps-simulator";
const TICK_MS = 4000;
const LOOP_MINUTES = 6; // one full run of a route, then the next trip starts
const DRIVER_PAUSE_MS = 15 * 60_000;
const SCHOOL = { lat: 13.085, lng: 80.2101 }; // Main Campus, Anna Nagar

type Pt = { lat: number; lng: number };

/** IST hour decides the trip type: mornings are pickups (stops → school), afternoons are drops (school → stops). */
function tripTypeNow(): "PICKUP" | "DROP" {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "PICKUP" : "DROP";
}

/**
 * Where the bus is after `progress` (0 → 1) of the trip, walking the path at constant speed.
 * Distance-weighted so long legs take longer than short ones; equirectangular distance is plenty at city scale.
 */
export function positionAlongPath(path: Pt[], progress: number): Pt {
  if (path.length === 1) return path[0];
  const legLen = (a: Pt, b: Pt) => Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180));
  const legs = path.slice(1).map((p, i) => legLen(path[i], p));
  const total = legs.reduce((s, l) => s + l, 0);
  let remaining = Math.min(Math.max(progress, 0), 1) * total;
  for (let i = 0; i < legs.length; i++) {
    if (remaining <= legs[i] || i === legs.length - 1) {
      const t = legs[i] === 0 ? 1 : Math.min(remaining / legs[i], 1);
      const a = path[i], b = path[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= legs[i];
  }
  return path[path.length - 1];
}

async function tickBus(bus: { id: string; routes: { stops: { lat: number | null; lng: number | null }[] }[] }) {
  const stops = bus.routes[0]?.stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: s.lat!, lng: s.lng! })) ?? [];
  if (stops.length < 2) return;

  const latest = await db.busTrip.findFirst({ where: { busId: bus.id }, orderBy: { startedAt: "desc" } });
  let trip = latest && !latest.endedAt ? latest : null;
  if (trip && trip.startedById !== SIM) return; // a real driver is running this bus
  if (!trip && latest?.endedAt && Date.now() - latest.endedAt.getTime() < DRIVER_PAUSE_MS) return; // a driver just ended a trip here

  const now = new Date();
  if (trip && now.getTime() - trip.startedAt.getTime() >= LOOP_MINUTES * 60_000) {
    // Arrived: close this run and immediately start the next one (so "ended by someone else" stays detectable above).
    await db.busTrip.update({ where: { id: trip.id }, data: { endedAt: now } });
    trip = null;
  }
  if (!trip) trip = await db.busTrip.create({ data: { busId: bus.id, type: tripTypeNow(), startedById: SIM, startedAt: now } });

  const path = trip.type === "PICKUP" ? [...stops, SCHOOL] : [SCHOOL, ...[...stops].reverse()];
  const progress = (now.getTime() - trip.startedAt.getTime()) / (LOOP_MINUTES * 60_000);
  const { lat, lng } = positionAlongPath(path, progress);
  const speed = 18 + Math.round(Math.random() * 14); // km/h, city traffic

  await db.busLocation.create({ data: { busId: bus.id, lat, lng, speed, recordedAt: now } });
  await db.bus.update({ where: { id: bus.id }, data: { lastLat: lat, lastLng: lng, lastLocationAt: now } });
  await checkNearStops(trip.id, lat, lng);
}

async function tick() {
  const buses = await db.bus.findMany({
    where: { isActive: true },
    select: { id: true, routes: { where: { isActive: true }, take: 1, select: { stops: { orderBy: { sequence: "asc" }, select: { lat: true, lng: true } } } } },
  });
  await runWithContext({ userId: undefined, userName: "GPS simulator", skipAudit: true }, async () => {
    for (const b of buses) await tickBus(b).catch((e) => console.error("[mock-gps]", b.id, (e as Error).message));
    // Keep the location history small: an hour is enough for the POC.
    await db.busLocation.deleteMany({ where: { recordedAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
  });
}

export function startGpsSimulator() {
  const g = globalThis as unknown as { __mockGps?: boolean };
  if (g.__mockGps) return;
  g.__mockGps = true;
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick().catch((e) => console.error("[mock-gps] tick failed", e)).finally(() => { busy = false; });
  }, TICK_MS);
  console.log(`[mock-gps] simulated bus GPS running (every ${TICK_MS / 1000}s, ${LOOP_MINUTES}-minute loops)`);
}
