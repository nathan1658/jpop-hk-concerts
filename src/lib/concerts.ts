import { collection, doc, getDoc, getDocs, onSnapshot } from "firebase/firestore";

import { seedConcerts } from "@/data/concerts";
import { getClientDb } from "@/lib/firebase";
import type { ConcertEvent, SyncMetadata, TicketStatus } from "@/types/concert";

export const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";
export const SOURCE_SYNC_METADATA_ID = "source-sync";

export const getHongKongDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const getFirstDate = (event: ConcertEvent) => event.dates[0] ?? "";

export const getLastDate = (event: ConcertEvent) =>
  event.dates[event.dates.length - 1] ?? getFirstDate(event);

export const getEventTime = (date: string) => new Date(`${date}T00:00:00+08:00`);

export const isPastEvent = (event: ConcertEvent) =>
  getLastDate(event) < getHongKongDateKey();

export const getSaleTime = (event: ConcertEvent) =>
  event.generalSaleStart ? new Date(event.generalSaleStart) : null;

export const hasSaleStarted = (event: ConcertEvent, now = new Date()) => {
  const saleTime = getSaleTime(event);
  return saleTime ? saleTime.getTime() <= now.getTime() : false;
};

export const normalizeStatus = (event: ConcertEvent, now = new Date()): TicketStatus => {
  if (isPastEvent(event)) {
    return "past";
  }

  if (event.status === "sold-out") {
    return "sold-out";
  }

  const saleTime = getSaleTime(event);

  if (saleTime) {
    return saleTime.getTime() <= now.getTime() ? "on-sale" : "soon";
  }

  return event.status;
};

export const sortConcerts = (events: ConcertEvent[]) =>
  [...events].sort(
    (a, b) => getEventTime(getFirstDate(a)).getTime() - getEventTime(getFirstDate(b)).getTime(),
  );

export const loadConcerts = async (): Promise<{
  events: ConcertEvent[];
  source: "firestore" | "seed";
}> => {
  const db = getClientDb();

  if (!db) {
    return { events: sortConcerts(seedConcerts), source: "seed" };
  }

  try {
    const snapshot = await getDocs(collection(db, "concerts"));
    const firestoreEvents = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ConcertEvent[];

    if (!firestoreEvents.length) {
      return { events: sortConcerts(seedConcerts), source: "seed" };
    }

    return { events: sortConcerts(firestoreEvents), source: "firestore" };
  } catch (error) {
    console.warn("Falling back to seed concerts", error);
    return { events: sortConcerts(seedConcerts), source: "seed" };
  }
};

export const subscribeToConcerts = (
  onChange: (payload: { events: ConcertEvent[]; source: "firestore" | "seed" }) => void,
  onError: (error: unknown) => void,
) => {
  const db = getClientDb();

  if (!db) {
    return null;
  }

  return onSnapshot(
    collection(db, "concerts"),
    (snapshot) => {
      const firestoreEvents = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ConcertEvent[];

      onChange(
        firestoreEvents.length
          ? { events: sortConcerts(firestoreEvents), source: "firestore" }
          : { events: sortConcerts(seedConcerts), source: "seed" },
      );
    },
    onError,
  );
};

const toSyncMetadata = (id: string, data: Record<string, unknown>): SyncMetadata => ({
  id,
  status: data.status === "partial" || data.status === "failed" ? data.status : "success",
  lastRunAt: typeof data.lastRunAt === "string" ? data.lastRunAt : "",
  lastUpdatedAt: typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt : "",
  lastVerified: typeof data.lastVerified === "string" ? data.lastVerified : "",
  eventCount: typeof data.eventCount === "number" ? data.eventCount : Number(data.eventCount ?? 0),
  failureCount:
    typeof data.failureCount === "number" ? data.failureCount : Number(data.failureCount ?? 0),
  sourceCount: typeof data.sourceCount === "number" ? data.sourceCount : Number(data.sourceCount ?? 0),
});

export const loadSyncMetadata = async (): Promise<SyncMetadata | null> => {
  const db = getClientDb();

  if (!db) {
    return null;
  }

  try {
    const snapshot = await getDoc(doc(db, "metadata", SOURCE_SYNC_METADATA_ID));
    return snapshot.exists()
      ? toSyncMetadata(snapshot.id, snapshot.data() as Record<string, unknown>)
      : null;
  } catch (error) {
    console.warn("Sync metadata unavailable", error);
    return null;
  }
};

export const subscribeToSyncMetadata = (
  onChange: (metadata: SyncMetadata | null) => void,
  onError: (error: unknown) => void,
) => {
  const db = getClientDb();

  if (!db) {
    return null;
  }

  return onSnapshot(
    doc(db, "metadata", SOURCE_SYNC_METADATA_ID),
    (snapshot) => {
      onChange(
        snapshot.exists()
          ? toSyncMetadata(snapshot.id, snapshot.data() as Record<string, unknown>)
          : null,
      );
    },
    onError,
  );
};

export const formatDateRange = (dates: string[]) => {
  if (dates.length === 0) {
    return "日期待定";
  }

  const formatter = new Intl.DateTimeFormat("zh-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "short",
    day: "numeric",
    weekday: "short",
  });

  if (dates.length === 1) {
    return formatter.format(getEventTime(dates[0]));
  }

  return `${formatter.format(getEventTime(dates[0]))} 至 ${formatter.format(
    getEventTime(dates[dates.length - 1]),
  )}`;
};

export const formatMonthKey = (date: string) =>
  new Intl.DateTimeFormat("zh-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(getEventTime(date));

export const formatSaleDateTime = (date: string) =>
  new Intl.DateTimeFormat("zh-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));

export const formatHongKongDateTime = (date: string) => {
  const value = new Date(date);

  if (Number.isNaN(value.getTime())) {
    return date;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute} HKT`;
};
