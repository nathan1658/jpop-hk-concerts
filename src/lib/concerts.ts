import { collection, getDocs, onSnapshot } from "firebase/firestore";

import { seedConcerts } from "@/data/concerts";
import { getClientDb } from "@/lib/firebase";
import type { ConcertEvent, TicketStatus } from "@/types/concert";

export const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

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

export const formatDateRange = (dates: string[]) => {
  if (dates.length === 0) {
    return "Date TBC";
  }

  const formatter = new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "short",
    day: "numeric",
    weekday: "short",
  });

  if (dates.length === 1) {
    return formatter.format(getEventTime(dates[0]));
  }

  return `${formatter.format(getEventTime(dates[0]))} - ${formatter.format(
    getEventTime(dates[dates.length - 1]),
  )}`;
};

export const formatMonthKey = (date: string) =>
  new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(getEventTime(date));

export const formatSaleDateTime = (date: string) =>
  new Intl.DateTimeFormat("en-HK", {
    timeZone: HONG_KONG_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
