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
  Plus,
  Search,
  Star,
  Ticket,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { seedConcerts } from "@/data/concerts";
import { monitoredSources } from "@/data/sources";
import {
  formatDateRange,
  formatHongKongDateTime,
  formatMonthKey,
  formatSaleDateTime,
  getEventTime,
  getFirstDate,
  getHongKongDateKey,
  getLastDate,
  getSaleTime,
  loadConcerts,
  loadSyncMetadata,
  normalizeStatus,
  sortConcerts,
  subscribeToConcerts,
  subscribeToSyncMetadata,
} from "@/lib/concerts";
import type { ConcertEvent, SyncMetadata, TicketStatus } from "@/types/concert";

type ViewMode = "upcoming" | "all" | "saved";
type NewRecordAlertMode = "off" | "all" | "artists";

const statusLabel: Record<TicketStatus, string> = {
  "on-sale": "售票中",
  soon: "即將開售",
  "sold-out": "已售罄",
  watching: "留意中",
  past: "已完結",
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
const NEW_RECORD_ALERT_MODE_KEY = "jpop-hk-new-record-alert-mode";
const NEW_RECORD_ARTISTS_KEY = "jpop-hk-new-record-artists";
const KNOWN_EVENT_IDS_KEY = "jpop-hk-known-event-ids";
const BANNER_KEY = "jpop-hk-banner";

const bannerOptions = [
  {
    id: "lisa-red",
    label: "紅黑舞台",
    src: "https://dynamicmedia.livenationinternational.com/p/s/r/19112c29-89f7-4c46-9a82-477def8a04fd.png?format=webp&width=1200&quality=75",
    position: "center",
    overlay:
      "linear-gradient(90deg, rgba(19, 19, 20, .92) 0%, rgba(24, 20, 20, .78) 42%, rgba(120, 34, 28, .38) 74%, rgba(12, 14, 15, .22) 100%)",
  },
  {
    id: "zutomayo-lab",
    label: "實驗室綠",
    src: "https://www.asiaworld-expo.com/AsiaWorldExpoLocal/media/AWE/ZTMY_HK-2026-AWE_1100x704_1.jpg?ext=.jpg",
    position: "center",
    overlay:
      "linear-gradient(90deg, rgba(9, 32, 30, .94) 0%, rgba(10, 52, 48, .76) 45%, rgba(38, 88, 79, .36) 74%, rgba(9, 32, 30, .24) 100%)",
  },
  {
    id: "arena-blue",
    label: "Arena 藍",
    src: "https://www.asiaworld-expo.com/AsiaWorldExpoLocal/media/AWE/1100x704_1.png?ext=.png",
    position: "center",
    overlay:
      "linear-gradient(90deg, rgba(14, 29, 45, .95) 0%, rgba(22, 45, 72, .78) 44%, rgba(72, 96, 133, .34) 74%, rgba(14, 29, 45, .24) 100%)",
  },
  {
    id: "city-night",
    label: "香港夜景",
    src: "/assets/concert-city-banner.png",
    position: "center",
    overlay:
      "linear-gradient(90deg, rgba(8, 33, 38, .94) 0%, rgba(8, 33, 38, .78) 38%, rgba(8, 33, 38, .42) 70%, rgba(8, 33, 38, .25) 100%)",
  },
] as const;

type BannerId = (typeof bannerOptions)[number]["id"];

const defaultBannerId: BannerId = "lisa-red";

const isBannerId = (value: string): value is BannerId =>
  bannerOptions.some((option) => option.id === value);

const sourceConfidenceLabel: Record<ConcertEvent["sourceConfidence"], string> = {
  official: "官方",
  promoter: "主辦",
  ticketing: "票務",
  venue: "場地",
};

const dataQualityLabel: Record<ConcertEvent["dataQuality"], string> = {
  verified: "已核實",
  partial: "待補資料",
};

const cadenceLabel: Record<string, string> = {
  daily: "每日",
  "twice-weekly": "每週兩次",
  weekly: "每週",
};

const priorityLabel: Record<string, string> = {
  high: "高優先",
  medium: "中優先",
};

const genreLabel: Record<string, string> = {
  Alternative: "另類",
  Rock: "搖滾",
  "J-Pop": "日本流行",
  "Singer-songwriter": "唱作",
  VTuber: "VTuber",
  "Virtual Artist": "虛擬歌手",
  Anisong: "動畫歌",
  "Bossa Nova": "Bossa Nova",
  Jazz: "爵士",
  Pop: "流行",
  "Pop Rock": "流行搖滾",
  "Hip Hop": "Hip Hop",
  "Alternative R&B": "另類 R&B",
};

const notificationPermissionLabel: Record<NotificationPermission | "unsupported", string> = {
  default: "未設定",
  denied: "已封鎖",
  granted: "已允許",
  unsupported: "此瀏覽器不支援",
};

const formatGenre = (genre: string) => genreLabel[genre] ?? genre;

const normalizeForMatch = (value: string) => value.trim().toLowerCase();

const getShowCountdownLabel = (event: ConcertEvent, now: Date) => {
  const todayKey = getHongKongDateKey(now);
  const eventDateKey = event.dates.find((date) => date >= todayKey) ?? getLastDate(event);
  const diff = Math.ceil(
    (getEventTime(eventDateKey).getTime() - getEventTime(todayKey).getTime()) / DAY_MS,
  );

  if (eventDateKey === todayKey) {
    return "今晚";
  }

  if (diff === 1) {
    return "明日";
  }

  if (diff > 1) {
    return `${diff} 日後`;
  }

  return "已完結";
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
    parts.push(`${days} 日`);
  }

  if (hours || days) {
    parts.push(`${hours} 小時`);
  }

  if (!days) {
    parts.push(`${minutes} 分鐘`);
  }

  return parts.slice(0, 2).join(" ");
};

const getSaleCountdownLabel = (event: ConcertEvent, now: Date) => {
  const saleTime = getSaleTime(event);

  if (!saleTime || !event.generalSaleStart) {
    return "未公布公開發售時間";
  }

  const duration = getDurationLabel(saleTime, now);

  if (duration) {
    return `距離公開發售 ${duration}`;
  }

  return `已於 ${formatSaleDateTime(event.generalSaleStart)} 開售`;
};

const getSaleNotice = (event: ConcertEvent, eventStatus: TicketStatus, now: Date) => {
  if (eventStatus === "past") {
    return {
      tone: "past",
      label: "演出已完結",
      detail: "保留來源作日後翻查",
    };
  }

  if (eventStatus === "sold-out") {
    return {
      tone: "sold-out",
      label: "門票已售罄",
      detail: event.generalSaleStart
        ? `公開發售：${formatSaleDateTime(event.generalSaleStart)}`
        : "請以官方票務為準",
    };
  }

  const saleTime = getSaleTime(event);

  if (!saleTime || !event.generalSaleStart) {
    return {
      tone: "watching",
      label: "未公布公開發售時間",
      detail: "等待官方來源更新",
    };
  }

  if (saleTime.getTime() > now.getTime()) {
    return {
      tone: "soon",
      label: getSaleCountdownLabel(event, now),
      detail: "公開發售",
    };
  }

  return {
    tone: "on-sale",
    label: `已於 ${formatSaleDateTime(event.generalSaleStart)} 開售`,
    detail: "公開發售",
  };
};

const saleNoticeClass: Record<string, string> = {
  "on-sale": "border-emerald-200 bg-emerald-50 text-emerald-950",
  soon: "border-amber-200 bg-amber-50 text-amber-950",
  "sold-out": "border-stone-200 bg-stone-100 text-stone-800",
  watching: "border-sky-200 bg-sky-50 text-sky-950",
  past: "border-zinc-200 bg-zinc-100 text-zinc-700",
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
    details: `資料來源：${event.sourceUrl}`,
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

const loadStoredMode = (): NewRecordAlertMode => {
  if (typeof window === "undefined") {
    return "off";
  }

  const stored = window.localStorage.getItem(NEW_RECORD_ALERT_MODE_KEY);
  return stored === "all" || stored === "artists" ? stored : "off";
};

const loadStoredBannerId = (): BannerId => {
  if (typeof window === "undefined") {
    return defaultBannerId;
  }

  const stored = window.localStorage.getItem(BANNER_KEY);
  return stored && isBannerId(stored) ? stored : defaultBannerId;
};

const eventMatchesArtistWatch = (event: ConcertEvent, artists: string[]) => {
  const haystack = normalizeForMatch(
    [event.artist, event.artistJa, event.tour].filter(Boolean).join(" "),
  );

  return artists.some((artist) => {
    const needle = normalizeForMatch(artist);
    return needle && haystack.includes(needle);
  });
};

export function ConcertDashboard() {
  const [events, setEvents] = useState<ConcertEvent[]>(seedConcerts);
  const [dataSource, setDataSource] = useState<"firestore" | "seed">("seed");
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("upcoming");
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [genre, setGenre] = useState("all");
  const [bannerId, setBannerId] = useState<BannerId>(defaultBannerId);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [alertIds, setAlertIds] = useState<string[]>([]);
  const [firedAlertIds, setFiredAlertIds] = useState<string[]>([]);
  const [newRecordMode, setNewRecordMode] = useState<NewRecordAlertMode>("off");
  const [artistWatchList, setArtistWatchList] = useState<string[]>([]);
  const [artistInput, setArtistInput] = useState("");
  const [knownEventIds, setKnownEventIds] = useState<string[]>([]);
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
      setNewRecordMode(loadStoredMode());
      setArtistWatchList(loadStoredIds(NEW_RECORD_ARTISTS_KEY));
      setKnownEventIds(loadStoredIds(KNOWN_EVENT_IDS_KEY));
      setBannerId(loadStoredBannerId());
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
    const unsubscribe = subscribeToSyncMetadata(
      (metadata) => setSyncMetadata(metadata),
      (error) => {
        console.warn("Realtime sync metadata unavailable", error);
        loadSyncMetadata().then((metadata) => setSyncMetadata(metadata));
      },
    );

    if (unsubscribe) {
      return unsubscribe;
    }

    loadSyncMetadata().then((metadata) => setSyncMetadata(metadata));
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
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(NEW_RECORD_ALERT_MODE_KEY, newRecordMode);
  }, [newRecordMode, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(NEW_RECORD_ARTISTS_KEY, JSON.stringify(artistWatchList));
  }, [artistWatchList, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(KNOWN_EVENT_IDS_KEY, JSON.stringify(knownEventIds));
  }, [knownEventIds, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    window.localStorage.setItem(BANNER_KEY, bannerId);
  }, [bannerId, storageReady]);

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }

    const dueEvents = events.filter((event) => {
      const saleTime = getSaleTime(event);
      const eventStatus = normalizeStatus(event, now);
      return (
        saleTime &&
        saleTime.getTime() <= now.getTime() &&
        eventStatus !== "sold-out" &&
        eventStatus !== "past" &&
        alertIds.includes(event.id) &&
        !firedAlertIds.includes(event.id)
      );
    });

    if (!dueEvents.length) {
      return;
    }

    for (const event of dueEvents) {
      new Notification(`${event.artist} 門票已開售`, {
        body: `${event.tour}｜${event.ticketingAgent ? `經 ${event.ticketingAgent} 發售` : "請查看官方票務"}`,
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

  useEffect(() => {
    if (!storageReady || isLoading) {
      return;
    }

    const currentIds = events.map((event) => event.id);

    if (!currentIds.length) {
      return;
    }

    if (!knownEventIds.length) {
      const timer = window.setTimeout(() => {
        setKnownEventIds(currentIds);
      }, 0);

      return () => window.clearTimeout(timer);
    }

    const knownSet = new Set(knownEventIds);
    const newEvents = events.filter((event) => !knownSet.has(event.id));

    if (!newEvents.length) {
      return;
    }

    const shouldNotify = (event: ConcertEvent) =>
      newRecordMode === "all" ||
      (newRecordMode === "artists" && eventMatchesArtistWatch(event, artistWatchList));
    const notifyEvents = newEvents.filter(shouldNotify);

    if (
      newRecordMode !== "off" &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      notifyEvents.length
    ) {
      for (const event of notifyEvents) {
        new Notification("新增香港演出紀錄", {
          body: `${event.artist}｜${formatDateRange(event.dates)}｜${event.venue}`,
          tag: `jpop-hk-new-${event.id}`,
        });
      }
    }

    const timer = window.setTimeout(() => {
      setKnownEventIds((current) => Array.from(new Set([...current, ...currentIds])));
    }, 0);

    return () => window.clearTimeout(timer);
  }, [artistWatchList, events, isLoading, knownEventIds, newRecordMode, storageReady]);

  const genres = useMemo(
    () => Array.from(new Set(events.flatMap((event) => event.genres))).sort(),
    [events],
  );
  const artistOptions = useMemo(
    () =>
      Array.from(
        new Set(
          events.flatMap((event) =>
            [event.artist, event.artistJa].filter((name): name is string => Boolean(name)),
          ),
        ),
      )
        .sort((a, b) => a.localeCompare(b, "zh-Hant-HK"))
        .slice(0, 10),
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
  const selectedBanner =
    bannerOptions.find((option) => option.id === bannerId) ??
    bannerOptions.find((option) => option.id === defaultBannerId) ??
    bannerOptions[0];
  const syncRunLabel = syncMetadata?.lastRunAt
    ? formatHongKongDateTime(syncMetadata.lastRunAt)
    : null;
  const syncStatusLabel =
    syncMetadata?.status === "partial"
      ? "部分成功"
      : syncMetadata?.status === "failed"
        ? "失敗"
        : "成功";
  const syncMetricDetail = syncRunLabel
    ? `背景同步：${syncRunLabel}（${syncStatusLabel}）`
    : "來源同步日期";
  const verifiedMetricValue = syncMetadata?.lastVerified || lastVerified || "-";
  const dataSourceLabel = dataSource === "firestore" ? "即時資料" : "內置備份";

  const toggleSaved = (id: string) => {
    setSavedIds((current) =>
      current.includes(id) ? current.filter((savedId) => savedId !== id) : [...current, id],
    );
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return "unsupported";
    }

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;

    setNotificationPermission(permission);
    return permission;
  };

  const chooseNewRecordMode = async (mode: NewRecordAlertMode) => {
    if (mode === "off") {
      setNewRecordMode("off");
      return;
    }

    const permission = await requestNotificationPermission();

    if (permission === "granted") {
      setNewRecordMode(mode);
    }
  };

  const addArtistWatch = (artist: string) => {
    const trimmed = artist.trim();

    if (!trimmed) {
      return;
    }

    setArtistWatchList((current) => {
      const exists = current.some((item) => normalizeForMatch(item) === normalizeForMatch(trimmed));
      return exists ? current : [...current, trimmed];
    });
    setArtistInput("");
  };

  const removeArtistWatch = (artist: string) => {
    setArtistWatchList((current) =>
      current.filter((item) => normalizeForMatch(item) !== normalizeForMatch(artist)),
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

    const permission = await requestNotificationPermission();

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
          src={selectedBanner.src}
          alt=""
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 -z-20 object-cover"
          style={{ objectPosition: selectedBanner.position }}
        />
        <div className="absolute inset-0 -z-10" style={{ background: selectedBanner.overlay }} />
        <div className="mx-auto grid min-h-[520px] w-full max-w-7xl grid-cols-1 content-end gap-8 px-5 pb-8 pt-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-10">
          <div className="min-w-0 max-w-3xl">
            <h1 className="max-w-[7em] break-all font-serif text-[2.65rem] font-semibold leading-[1.08] text-[#fff8ea] sm:max-w-3xl sm:text-7xl sm:leading-[0.98]">
              日本音樂香港演出表
            </h1>
            <p className="mt-5 max-w-2xl break-words text-lg leading-8 text-[#d6e7e2]">
              集中睇日本歌手、樂隊、VTuber 同虛擬歌手來港演出，連票務狀態、場地、來源核實同新紀錄通知一齊跟。
            </p>
            <div
              className="mt-7 flex max-w-2xl flex-wrap gap-2"
              role="radiogroup"
              aria-label="選擇頁首 banner"
            >
              {bannerOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBannerId(option.id)}
                  aria-pressed={bannerId === option.id}
                  className={`group grid h-12 w-[136px] min-w-0 grid-cols-[42px_minmax(0,1fr)] items-center overflow-hidden border text-left text-xs font-bold transition ${
                    bannerId === option.id
                      ? "border-[#fff8ea] bg-[#fff8ea] text-[#12343a]"
                      : "border-white/25 bg-black/20 text-[#fff8ea] hover:border-white/60 hover:bg-black/35"
                  }`}
                >
                  <span
                    className="h-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${option.src})` }}
                    aria-hidden
                  />
                  <span className="truncate px-2">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 gap-3 self-end text-[#fff8ea] sm:grid-cols-3 lg:grid-cols-1">
            <Metric
              icon={<CalendarDays size={18} />}
              label="未完場"
              value={String(upcoming.length)}
              detail={nextEvent ? `下一場：${nextEvent.artist}` : "暫時未有未來演出"}
            />
            <Metric
              icon={<Ticket size={18} />}
              label="售票中"
              value={String(onSaleCount)}
              detail={dataSourceLabel}
            />
            <Metric
              icon={<CheckCircle2 size={18} />}
              label="最近核實"
              value={verifiedMetricValue}
              detail={syncMetricDetail}
            />
          </div>
        </div>
      </section>

      <section className="border-b border-black/10 bg-[#f8faf6]">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-5 sm:px-8 lg:grid-cols-[1fr_auto] lg:px-10">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
            <label className="group flex h-12 min-w-0 items-center gap-3 border border-black/15 bg-white px-4 shadow-[0_1px_0_rgba(0,0,0,.06)] focus-within:border-[#b93825]">
              <Search size={18} className="text-[#6c7772]" aria-hidden />
              <span className="sr-only">搜尋演出</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜尋歌手、VTuber、場地"
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-[#6f7775]"
              />
            </label>

            <SelectControl
              label="狀態"
              value={status}
              onChange={(value) => setStatus(value as TicketStatus | "all")}
              options={[
                ["all", "全部狀態"],
                ["on-sale", "售票中"],
                ["soon", "即將開售"],
                ["watching", "留意中"],
                ["sold-out", "已售罄"],
                ["past", "已完結"],
              ]}
            />

            <SelectControl
              label="類型"
              value={genre}
              onChange={setGenre}
              options={[
                ["all", "全部類型"],
                ...genres.map((item) => [item, formatGenre(item)] as const),
              ]}
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
                {mode === "upcoming" ? "未完場" : mode === "saved" ? "已收藏" : "全部"}
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
                演出列表
              </p>
              <h2 className="mt-1 text-2xl font-semibold">近期值得留意的香港場</h2>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#5a6761]">
              <Filter size={16} aria-hidden />
              顯示 {filteredEvents.length} 場
            </div>
          </div>

          {isLoading ? (
            <div className="border border-dashed border-black/20 bg-white px-5 py-14 text-center text-sm font-medium text-[#5d6763]">
              正在載入演出資料...
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="border border-dashed border-black/20 bg-white px-5 py-14 text-center">
              <p className="text-lg font-semibold">呢個篩選暫時未有演出。</p>
              <p className="mt-2 text-sm text-[#5d6763]">
                可以清走篩選，或者切回未完場列表。
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
                      const saleNotice = getSaleNotice(event, eventStatus, now);
                      const eventImage = event.imageUrl ?? "/assets/concert-city-banner.png";
                      const eventImageAlt = event.imageAlt ?? `${event.artist} 香港演出圖片`;

                      return (
                        <article
                          key={event.id}
                          className="grid gap-4 border border-black/10 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,.08)] transition hover:-translate-y-0.5 hover:border-[#b93825]/50 sm:grid-cols-[196px_minmax(0,1fr)]"
                        >
                          <div className="grid min-w-0 gap-0">
                            <div className="relative aspect-[16/10] overflow-hidden bg-[#12343a]">
                              <Image
                                src={eventImage}
                                alt={eventImageAlt}
                                fill
                                sizes="(min-width: 1024px) 196px, (min-width: 640px) 196px, 100vw"
                                className="object-cover"
                              />
                            </div>
                            <div className="grid min-h-32 content-between bg-[#12343a] p-4 text-[#fff8ea]">
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
                                    {sourceConfidenceLabel[event.sourceConfidence]}
                                  </span>
                                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6a756f]">
                                    {dataQualityLabel[event.dataQuality]}
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
                                aria-label={isSaved ? "取消收藏演出" : "收藏演出"}
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
                                    {event.ticketingAgent ?? "票務待公布"}
                                  </span>
                                  <br />
                                  {event.price ?? "票務資料待公布"}
                                </span>
                              </div>
                            </div>

                            <div
                              className={`mt-4 flex flex-wrap items-center gap-2 border px-3 py-2 text-sm ${saleNoticeClass[saleNotice.tone]}`}
                            >
                              <Clock3 size={16} className="shrink-0" aria-hidden />
                              <span className="font-bold">{saleNotice.label}</span>
                              {saleNotice.detail ? (
                                <span className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">
                                  {saleNotice.detail}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {event.genres.map((item) => (
                                <span
                                  key={item}
                                  className="bg-[#eef3ef] px-2.5 py-1 text-xs font-semibold text-[#32413b]"
                                >
                                  {formatGenre(item)}
                                </span>
                              ))}
                            </div>

                            {event.notes ? (
                              <p className="mt-4 border-l-2 border-[#d68b2a] pl-3 text-sm leading-6 text-[#5a625f]">
                                {event.notes}
                              </p>
                            ) : null}

                            <div className="mt-5 flex flex-wrap gap-3">
                              {event.ticketUrl && eventStatus !== "past" ? (
                                <a
                                  href={event.ticketUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-10 items-center gap-2 bg-[#b93825] px-4 text-sm font-bold text-white transition hover:bg-[#8f2c1d]"
                                >
                                  {eventStatus === "sold-out" ? "查看票務" : "買飛"}
                                  <ExternalLink size={15} aria-hidden />
                                </a>
                              ) : null}
                              <a
                                href={getCalendarUrl(event)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-10 items-center gap-2 border border-black/15 px-4 text-sm font-bold text-[#26312d] transition hover:border-[#12343a]"
                              >
                                加入日曆
                                <CalendarDays size={15} aria-hidden />
                              </a>
                              {isFutureSale && eventStatus !== "sold-out" && eventStatus !== "past" ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleSaleAlert(event)}
                                  disabled={notificationPermission === "unsupported"}
                                  className={`inline-flex h-10 items-center gap-2 border px-4 text-sm font-bold transition ${
                                    notificationPermission !== "unsupported"
                                      ? "border-black/15 text-[#26312d] hover:border-[#b93825]"
                                      : "cursor-not-allowed border-black/10 text-[#8a918e]"
                                  }`}
                                >
                                  <Bell size={15} aria-hidden />
                                  {isAlertSet ? "已設開售通知" : "開售通知"}
                                </button>
                              ) : null}
                              <a
                                href={event.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-10 items-center gap-2 border border-black/15 px-4 text-sm font-bold text-[#26312d] transition hover:border-[#12343a]"
                              >
                                來源
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
              通知設定
            </div>
            <p className="mt-3 text-2xl font-semibold leading-tight">
              新紀錄可以通知全部，亦可以只追指定歌手。
            </p>
            <p className="mt-3 text-sm leading-6 text-[#d4e6e1]">
              通知設定會儲存在呢個瀏覽器；頁面開住或下次開站見到新資料時，會按設定提示你。
            </p>

            <div className="mt-4 grid grid-cols-3 overflow-hidden border border-white/20 p-1 text-sm font-bold">
              {(
                [
                  ["off", "關閉"],
                  ["all", "全部"],
                  ["artists", "指定"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => void chooseNewRecordMode(mode)}
                  className={`h-10 min-w-0 px-2 transition ${
                    newRecordMode === mode
                      ? "bg-[#fff8ea] text-[#12343a]"
                      : "text-[#d4e6e1] hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {newRecordMode === "artists" ? (
              <div className="mt-4 space-y-3">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    addArtistWatch(artistInput);
                  }}
                  className="flex min-w-0 border border-white/20 bg-white/10"
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">加入指定歌手</span>
                    <input
                      value={artistInput}
                      onChange={(event) => setArtistInput(event.target.value)}
                      placeholder="輸入歌手名"
                      className="h-10 w-full bg-transparent px-3 text-sm font-medium text-white outline-none placeholder:text-[#b7d7cf]"
                    />
                  </label>
                  <button
                    type="submit"
                    aria-label="加入歌手"
                    className="grid h-10 w-10 place-items-center border-l border-white/20 text-[#fff8ea] transition hover:bg-white/10"
                  >
                    <Plus size={16} aria-hidden />
                  </button>
                </form>

                {artistWatchList.length ? (
                  <div className="flex flex-wrap gap-2">
                    {artistWatchList.map((artist) => (
                      <span
                        key={artist}
                        className="inline-flex min-w-0 items-center gap-2 bg-white/12 px-2.5 py-1 text-xs font-bold text-white ring-1 ring-white/20"
                      >
                        <span className="max-w-36 truncate">{artist}</span>
                        <button
                          type="button"
                          onClick={() => removeArtistWatch(artist)}
                          aria-label={`移除 ${artist}`}
                          className="grid size-5 place-items-center text-[#d4e6e1] transition hover:text-white"
                        >
                          <X size={13} aria-hidden />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[#d4e6e1]">
                    未有指定歌手；輸入歌手名後，只會通知相符的新紀錄。
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {artistOptions
                    .filter(
                      (artist) =>
                        !artistWatchList.some(
                          (watched) => normalizeForMatch(watched) === normalizeForMatch(artist),
                        ),
                    )
                    .slice(0, 6)
                    .map((artist) => (
                      <button
                        key={artist}
                        type="button"
                        onClick={() => addArtistWatch(artist)}
                        className="border border-white/20 px-2.5 py-1 text-xs font-bold text-[#d4e6e1] transition hover:border-white/50 hover:text-white"
                      >
                        {artist}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 border-t border-white/15 pt-4">
              <div className="mb-3 text-sm font-semibold text-[#b7d7cf]">開售倒數</div>
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
                  暫時未有未來公開發售時間；已核實的公開發售時段都已經開始。
                </p>
              )}
            </div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[#b7d7cf]">
              通知權限：{notificationPermissionLabel[notificationPermission]}
            </div>
          </section>

          <section className="border border-black/10 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">同步來源</h3>
              <span className="bg-[#eef3ef] px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#40514a]">
                {dataSourceLabel}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              <div className="border border-black/10 bg-[#f8faf6] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#69736e]">
                  上次背景同步
                </p>
                <p className="mt-1 text-sm font-semibold text-[#26312d]">
                  {syncRunLabel ?? "尚未讀到同步紀錄"}
                </p>
              </div>
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
                        {cadenceLabel[source.cadence]} / {priorityLabel[source.priority]}
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
      <div className="mt-1 break-words text-sm leading-5 text-[#d6e7e2]">{detail}</div>
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
