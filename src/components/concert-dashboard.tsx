"use client";

import Image from "next/image";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Filter,
  MapPin,
  RefreshCcw,
  Search,
  Star,
  Ticket,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { seedConcerts } from "@/data/concerts";
import { monitoredSources } from "@/data/sources";
import {
  formatDateRange,
  formatMonthKey,
  formatSaleDateTime,
  getEventTime,
  getFirstDate,
  getHongKongDateKey,
  getLastDate,
  getSaleTime,
  loadConcerts,
  normalizeStatus,
  sortConcerts,
  subscribeToConcerts,
} from "@/lib/concerts";
import type { ConcertEvent, TicketStatus } from "@/types/concert";

type ViewMode = "upcoming" | "all" | "saved";

const statusLabel: Record<TicketStatus, string> = {
  "on-sale": "On sale",
  soon: "Soon",
  "sold-out": "Sold out",
  watching: "Watching",
  past: "Past",
};

const statusClass: Record<TicketStatus, string> = {
  "on-sale": "bg-emerald-100 text-emerald-950 ring-emerald-200",
  soon: "bg-amber-100 text-amber-950 ring-amber-200",
  "sold-out": "bg-stone-200 text-stone-800 ring-stone-300",
  watching: "bg-sky-100 text-sky-950 ring-sky-200",
  past: "bg-zinc-200 text-zinc-700 ring-zinc-300",
};

const DAY_MS = 86_400_000;
const SAVED_KEY = "jpop-hk-saved";
const SALE_ALERTS_KEY = "jpop-hk-sale-alerts";
const FIRED_SALE_ALERTS_KEY = "jpop-hk-sale-alerts-fired";

const getShowCountdownLabel = (event: ConcertEvent, now: Date) => {
  const todayKey = getHongKongDateKey(now);
  const eventDateKey = event.dates.find((date) => date >= todayKey) ?? getLastDate(event);
  const diff = Math.ceil(
    (getEventTime(eventDateKey).getTime() - getEventTime(todayKey).getTime()) / DAY_MS,
  );

  if (eventDateKey === todayKey) {
    return "Tonight";
  }

  if (diff === 1) {
    return "Tomorrow";
  }

  if (diff > 1) {
    return `${diff} days`;
  }

  return "Archived";
};

const getDurationLabel = (target: Date, now: Date) => {
  const diff = target.getTime() - now.getTime();

  if (diff <= 0) {
    return null;
  }

  const totalMinutes = Math.ceil(diff / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days) {
    parts.push(`${days}d`);
  }

  if (hours || days) {
    parts.push(`${hours}h`);
  }

  if (!days) {
    parts.push(`${minutes}m`);
  }

  return parts.slice(0, 2).join(" ");
};

const getSaleCountdownLabel = (event: ConcertEvent, now: Date) => {
  const saleTime = getSaleTime(event);

  if (!saleTime || !event.generalSaleStart) {
    return "Sale time not published";
  }

  const duration = getDurationLabel(saleTime, now);

  if (duration) {
    return `Sale opens in ${duration}`;
  }

  return `Sale opened ${formatSaleDateTime(event.generalSaleStart)}`;
};

const getCalendarUrl = (event: ConcertEvent) => {
  const start = getFirstDate(event).replaceAll("-", "");
  const endDate = new Date(getEventTime(getLastDate(event)));
  endDate.setDate(endDate.getDate() + 1);
  const end = endDate.toISOString().slice(0, 10).replaceAll("-", "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${event.artist} - ${event.tour}`,
    dates: `${start}/${end}`,
    location: event.venue,
    details: `Source: ${event.sourceUrl}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

const loadStoredIds = (key: string) => {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return [];
  }

  try {
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
};

export function ConcertDashboard() {
  const [events, setEvents] = useState<ConcertEvent[]>(seedConcerts);
  const [dataSource, setDataSource] = useState<"firestore" | "seed">("seed");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [genre, setGenre] = useState("all");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [alertIds, setAlertIds] = useState<string[]>([]);
  const [firedAlertIds, setFiredAlertIds] = useState<string[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [storageReady, setStorageReady] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedIds(loadStoredIds(SAVED_KEY));
      setAlertIds(loadStoredIds(SALE_ALERTS_KEY));
      setFiredAlertIds(loadStoredIds(FIRED_SALE_ALERTS_KEY));
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
      setStorageReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let hasFirstPayload = false;
    const fallbackTimer = window.setTimeout(() => {
      if (hasFirstPayload) {
        return;
      }

      setEvents(sortConcerts(seedConcerts));
      setDataSource("seed");
      setIsLoading(false);
    }, 3_500);

    const unsubscribe = subscribeToConcerts(
      ({ events: liveEvents, source }) => {
        hasFirstPayload = true;
        setEvents(liveEvents);
        setDataSource(source);
        setIsLoading(false);
      },
      (error) => {
        console.warn("Realtime concerts unavailable", error);
        loadConcerts()
          .then(({ events: loadedEvents, source }) => {
            setEvents(loadedEvents);
            setDataSource(source);
          })
          .finally(() => {
            hasFirstPayload = true;
            setIsLoading(false);
          });
      },
    );

    if (unsubscribe) {
      return () => {
        window.clearTimeout(fallbackTimer);
        unsubscribe();
      };
    }

    loadConcerts()
      .then(({ events: loadedEvents, source }) => {
        hasFirstPayload = true;
        setEvents(loadedEvents);
        setDataSource(source);
      })
      .finally(() => {
        hasFirstPayload = true;
        setIsLoading(false);
      });

    return () => window.clearTimeout(fallbackTimer);
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
  }, [savedIds, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(SALE_ALERTS_KEY, JSON.stringify(alertIds));
  }, [alertIds, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(FIRED_SALE_ALERTS_KEY, JSON.stringify(firedAlertIds));
  }, [firedAlertIds, storageReady]);

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    const dueEvents = events.filter((event) => {
      const saleTime = getSaleTime(event);
      return (
        saleTime &&
        saleTime.getTime() <= now.getTime() &&
        alertIds.includes(event.id) &&
        !firedAlertIds.includes(event.id)
      );
    });

    if (!dueEvents.length) {
      return;
    }

    for (const event of dueEvents) {
      new Notification(`${event.artist} tickets are on sale`, {
        body: `${event.tour} ${event.ticketingAgent ? `via ${event.ticketingAgent}` : "via official ticketing"}.`,
        tag: `jpop-hk-sale-${event.id}`,
      });
    }

    const timer = window.setTimeout(() => {
      setFiredAlertIds((current) =>
        Array.from(new Set([...current, ...dueEvents.map((event) => event.id)])),
      );
    }, 0);

    return () => window.clearTimeout(timer);
  }, [alertIds, events, firedAlertIds, now]);

  const genres = useMemo(
    () => Array.from(new Set(events.flatMap((event) => event.genres))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return events.filter((event) => {
      const eventStatus = normalizeStatus(event, now);
      const haystack = [
        event.artist,
        event.artistJa,
        event.tour,
        event.venue,
        event.district,
        event.genres.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (viewMode === "upcoming" && eventStatus === "past") {
        return false;
      }

      if (viewMode === "saved" && !savedIds.includes(event.id)) {
        return false;
      }

      if (status !== "all" && eventStatus !== status) {
        return false;
      }

      if (genre !== "all" && !event.genres.includes(genre)) {
        return false;
      }

      return !normalizedQuery || haystack.includes(normalizedQuery);
    });
  }, [events, genre, now, query, savedIds, status, viewMode]);

  const groupedEvents = useMemo(() => {
    return filteredEvents.reduce<Record<string, ConcertEvent[]>>((groups, event) => {
      const key = formatMonthKey(getFirstDate(event));
      groups[key] = [...(groups[key] ?? []), event];
      return groups;
    }, {});
  }, [filteredEvents]);

  const upcoming = events.filter((event) => normalizeStatus(event, now) !== "past");
  const nextEvent = upcoming[0];
  const onSaleCount = upcoming.filter((event) => normalizeStatus(event, now) === "on-sale").length;
  const futureSaleEvents = upcoming
    .filter((event) => {
      const saleTime = getSaleTime(event);
      return saleTime && saleTime.getTime() > now.getTime();
    })
    .sort((a, b) => (getSaleTime(a)?.getTime() ?? 0) - (getSaleTime(b)?.getTime() ?? 0));
  const lastVerified = events
    .map((event) => event.lastVerified)
    .sort()
    .at(-1);

  const toggleSaved = (id: string) => {
    setSavedIds((current) =>
      current.includes(id) ? current.filter((savedId) => savedId !== id) : [...current, id],
    );
  };

  const toggleSaleAlert = async (event: ConcertEvent) => {
    const saleTime = getSaleTime(event);

    if (!saleTime || saleTime.getTime() <= now.getTime()) {
      return;
    }

    if (alertIds.includes(event.id)) {
      setAlertIds((current) => current.filter((alertId) => alertId !== event.id));
      return;
    }

    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;

    setNotificationPermission(permission);

    if (permission !== "granted") {
      return;
    }

    setAlertIds((current) => Array.from(new Set([...current, event.id])));
    setFiredAlertIds((current) => current.filter((alertId) => alertId !== event.id));
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--page)] text-[var(--ink)]">
      <section className="relative isolate overflow-hidden border-b border-black/10">
        <Image
          src="/assets/concert-city-banner.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,33,38,.94)_0%,rgba(8,33,38,.78)_38%,rgba(8,33,38,.42)_70%,rgba(8,33,38,.25)_100%)]" />
        <div className="mx-auto grid min-h-[520px] w-full max-w-7xl grid-cols-1 content-end gap-8 px-5 pb-8 pt-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-10">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 border border-white/25 bg-white/10 px-3 py-2 text-sm font-medium text-white backdrop-blur">
              <RefreshCcw size={16} aria-hidden />
              Firestore first. Official-source fallback.
            </div>
            <h1 className="max-w-[7em] break-all font-serif text-[2.65rem] font-semibold leading-[1.08] text-[#fff8ea] sm:max-w-3xl sm:text-7xl sm:leading-[0.98]">
              日本音樂香港演出表
            </h1>
            <p className="mt-5 max-w-2xl break-words text-lg leading-8 text-[#d6e7e2]">
              Track Japanese artists, VTubers, virtual artists, venue dates, ticket status, and
              source verification in one focused Hong Kong concert board.
            </p>
          </div>

          <div className="grid min-w-0 gap-3 self-end text-[#fff8ea]">
            <Metric
              icon={<CalendarDays size={18} />}
              label="Upcoming"
              value={String(upcoming.length)}
              detail={nextEvent ? `Next: ${nextEvent.artist}` : "No upcoming events"}
            />
            <Metric
              icon={<Ticket size={18} />}
              label="On sale"
              value={String(onSaleCount)}
              detail={dataSource === "firestore" ? "Live Firestore data" : "Seed data fallback"}
            />
            <Metric
              icon={<CheckCircle2 size={18} />}
              label="Verified"
              value={lastVerified ?? "-"}
              detail="Latest source check"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-[#f8faf6]">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-5 sm:px-8 lg:grid-cols-[1fr_auto] lg:px-10">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
            <label className="group flex h-12 min-w-0 items-center gap-3 border border-black/15 bg-white px-4 shadow-[0_1px_0_rgba(0,0,0,.06)] focus-within:border-[#b93825]">
              <Search size={18} className="text-[#6c7772]" aria-hidden />
              <span className="sr-only">Search concerts</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search artist, VTuber, venue"
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-[#6f7775]"
              />
            </label>

            <SelectControl
              label="Status"
              value={status}
              onChange={(value) => setStatus(value as TicketStatus | "all")}
              options={[
                ["all", "All status"],
                ["on-sale", "On sale"],
                ["soon", "Soon"],
                ["watching", "Watching"],
                ["sold-out", "Sold out"],
                ["past", "Past"],
              ]}
            />

            <SelectControl
              label="Genre"
              value={genre}
              onChange={setGenre}
              options={[["all", "All genres"], ...genres.map((item) => [item, item] as const)]}
            />
          </div>

          <div className="grid min-w-0 grid-cols-3 overflow-hidden border border-black/15 bg-white p-1 text-sm font-semibold">
            {(["upcoming", "all", "saved"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`h-10 min-w-0 truncate px-3 transition ${
                  viewMode === mode
                    ? "bg-[#12343a] text-white"
                    : "text-[#36413d] hover:bg-[#e8eee9]"
                }`}
              >
                {mode === "upcoming" ? "Upcoming" : mode === "saved" ? "Saved" : "All"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-10">
        <div className="min-w-0">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a33a28]">
                Concert Board
              </p>
              <h2 className="mt-1 text-2xl font-semibold">Dates that still matter</h2>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#5a6761]">
              <Filter size={16} aria-hidden />
              {filteredEvents.length} shown
            </div>
          </div>

          {isLoading ? (
            <div className="border border-dashed border-black/20 bg-white px-5 py-14 text-center text-sm font-medium text-[#5d6763]">
              Loading concert board...
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="border border-dashed border-black/20 bg-white px-5 py-14 text-center">
              <p className="text-lg font-semibold">No dates match this view.</p>
              <p className="mt-2 text-sm text-[#5d6763]">
                Clear a filter or switch back to upcoming events.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedEvents).map(([month, monthEvents]) => (
                <section key={month} aria-labelledby={`month-${month}`}>
                  <div className="sticky top-0 z-10 mb-3 flex items-center gap-3 bg-[var(--page)] py-3">
                    <h3 id={`month-${month}`} className="text-lg font-semibold">
                      {month}
                    </h3>
                    <div className="h-px flex-1 bg-black/10" />
                  </div>

                  <div className="grid gap-3">
                    {monthEvents.map((event) => {
                      const eventStatus = normalizeStatus(event, now);
                      const isSaved = savedIds.includes(event.id);
                      const isAlertSet = alertIds.includes(event.id);
                      const saleTime = getSaleTime(event);
                      const isFutureSale = Boolean(saleTime && saleTime.getTime() > now.getTime());

                      return (
                        <article
                          key={event.id}
                          className="grid gap-4 border border-black/10 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,.08)] transition hover:-translate-y-0.5 hover:border-[#b93825]/50 sm:grid-cols-[148px_minmax(0,1fr)]"
                        >
                          <div className="flex sm:block">
                            <div className="grid min-h-32 flex-1 content-between bg-[#12343a] p-4 text-[#fff8ea]">
                              <div className="text-sm font-semibold uppercase tracking-[0.14em] text-[#b7d7cf]">
                                {getShowCountdownLabel(event, now)}
                              </div>
                              <div>
                                <div className="text-2xl font-semibold">
                                  {formatDateRange(event.dates)}
                                </div>
                                {event.doors ? (
                                  <div className="mt-1 flex items-center gap-1 text-sm text-[#d8e6e1]">
                                    <Clock3 size={14} aria-hidden />
                                    {event.doors}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-1 text-xs font-bold ring-1 ${statusClass[eventStatus]}`}
                                  >
                                    {statusLabel[eventStatus]}
                                  </span>
                                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6a756f]">
                                    {event.sourceConfidence}
                                  </span>
                                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6a756f]">
                                    {event.dataQuality}
                                  </span>
                                </div>
                                <h4 className="mt-3 text-2xl font-semibold leading-tight">
                                  {event.artist}
                                  {event.artistJa ? (
                                    <span className="ml-2 text-base font-medium text-[#69736e]">
                                      {event.artistJa}
                                    </span>
                                  ) : null}
                                </h4>
                                <p className="mt-1 text-base font-medium text-[#36413d]">
                                  {event.tour}
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleSaved(event.id)}
                                aria-label={isSaved ? "Remove from saved" : "Save concert"}
                                className={`grid size-10 place-items-center border transition ${
                                  isSaved
                                    ? "border-[#b93825] bg-[#b93825] text-white"
                                    : "border-black/15 bg-white text-[#39443f] hover:border-[#b93825]"
                                }`}
                              >
                                <Star size={18} fill={isSaved ? "currentColor" : "none"} />
                              </button>
                            </div>

                            <div className="mt-4 grid gap-3 text-sm text-[#4b5852] sm:grid-cols-2">
                              <div className="flex gap-2">
                                <MapPin size={17} className="mt-0.5 shrink-0 text-[#b93825]" />
                                <span>
                                  <span className="font-semibold text-[#26312d]">
                                    {event.venue}
                                  </span>
                                  <br />
                                  {event.district}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Ticket size={17} className="mt-0.5 shrink-0 text-[#b93825]" />
                                <span>
                                  <span className="font-semibold text-[#26312d]">
                                    {event.ticketingAgent ?? "Ticketing TBA"}
                                  </span>
                                  <br />
                                  {event.price ?? "Ticket details pending"}
                                </span>
                              </div>
                            </div>

                            <div
                              className={`mt-4 flex flex-wrap items-center gap-2 border px-3 py-2 text-sm ${
                                isFutureSale
                                  ? "border-amber-200 bg-amber-50 text-amber-950"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-950"
                              }`}
                            >
                              <Clock3 size={16} className="shrink-0" aria-hidden />
                              <span className="font-bold">{getSaleCountdownLabel(event, now)}</span>
                              {event.generalSaleStart ? (
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">
                                  General sale
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {event.genres.map((item) => (
                                <span
                                  key={item}
                                  className="bg-[#eef3ef] px-2.5 py-1 text-xs font-semibold text-[#32413b]"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>

                            {event.notes ? (
                              <p className="mt-4 border-l-2 border-[#d68b2a] pl-3 text-sm leading-6 text-[#5a625f]">
                                {event.notes}
                              </p>
                            ) : null}

                            <div className="mt-5 flex flex-wrap gap-3">
                              {event.ticketUrl ? (
                                <a
                                  href={event.ticketUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-10 items-center gap-2 bg-[#b93825] px-4 text-sm font-bold text-white transition hover:bg-[#8f2c1d]"
                                >
                                  Tickets
                                  <ExternalLink size={15} aria-hidden />
                                </a>
                              ) : null}
                              <a
                                href={getCalendarUrl(event)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-10 items-center gap-2 border border-black/15 px-4 text-sm font-bold text-[#26312d] transition hover:border-[#12343a]"
                              >
                                Calendar
                                <CalendarDays size={15} aria-hidden />
                              </a>
                              {saleTime ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleSaleAlert(event)}
                                  disabled={!isFutureSale || notificationPermission === "unsupported"}
                                  className={`inline-flex h-10 items-center gap-2 border px-4 text-sm font-bold transition ${
                                    isFutureSale && notificationPermission !== "unsupported"
                                      ? "border-black/15 text-[#26312d] hover:border-[#b93825]"
                                      : "cursor-not-allowed border-black/10 text-[#8a918e]"
                                  }`}
                                >
                                  <Bell size={15} aria-hidden />
                                  {isFutureSale ? (isAlertSet ? "Alert set" : "Sale alert") : "Sale open"}
                                </button>
                              ) : null}
                              <a
                                href={event.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-10 items-center gap-2 border border-black/15 px-4 text-sm font-bold text-[#26312d] transition hover:border-[#12343a]"
                              >
                                Source
                                <ExternalLink size={15} aria-hidden />
                              </a>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="border border-black/10 bg-[#12343a] p-5 text-[#fff8ea]">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[#b7d7cf]">
              <Bell size={16} aria-hidden />
              Sale alerts
            </div>
            <p className="mt-3 text-2xl font-semibold leading-tight">
              Countdown and browser notification for future ticket drops.
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d4e6e1]">
              Alerts are local to this browser and fire while the page is open after permission is
              granted. Background push needs Firebase Cloud Messaging next.
            </p>
            <div className="mt-4 border-t border-white/15 pt-4">
              {futureSaleEvents.length ? (
                <div className="space-y-3">
                  {futureSaleEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="text-sm">
                      <div className="font-bold">{event.artist}</div>
                      <div className="mt-1 text-[#d4e6e1]">{getSaleCountdownLabel(event, now)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm leading-6 text-[#d4e6e1]">
                  No future ticket-sale countdown is active. All verified sale windows in this
                  dataset have already opened.
                </p>
              )}
            </div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#b7d7cf]">
              Permission: {notificationPermission}
            </div>
          </section>

          <section className="border border-black/10 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Update Sources</h3>
              <span className="bg-[#eef3ef] px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#40514a]">
                {dataSource}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {monitoredSources.map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group block border border-black/10 p-3 transition hover:border-[#b93825]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{source.name}</p>
                      <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-[#69736e]">
                        {source.cadence} / {source.priority}
                      </p>
                    </div>
                    <ExternalLink
                      size={16}
                      className="mt-1 shrink-0 text-[#7a8580] group-hover:text-[#b93825]"
                      aria-hidden
                    />
                  </div>
                </a>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 border border-white/20 bg-white/10 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-[#b7d7cf]">
        {icon}
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-[#d6e7e2]">{detail}</div>
    </div>
  );
}

function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex h-12 min-w-0 items-center border border-black/15 bg-white px-4 shadow-[0_1px_0_rgba(0,0,0,.06)]">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none bg-transparent pr-8 text-sm font-bold text-[#26312d] outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      <ChevronDown
        size={17}
        className="pointer-events-none absolute right-4 text-[#6c7772]"
        aria-hidden
      />
    </label>
  );
}
