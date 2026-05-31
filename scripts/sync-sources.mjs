import { seedConcerts } from "../src/data/concerts.ts";
import { writeConcerts } from "./lib/firestore-rest.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const userAgent = "jpop-hk-concerts-sync/0.1 (+https://github.com/nathan1658/jpop-hk-concerts)";
const monthNumbers = new Map(
  Object.entries({
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12",
  }),
);

const todayHongKong = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const decodeHtml = (value) =>
  value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const textFromHtml = (html) =>
  decodeHtml(
    html
      .replace(/<head[\s\S]*?<\/head>/i, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(h1|h2|h3|h4|p|li|td|th|tr|div|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const normalizeText = (value) => value.replace(/\s+/g, " ").trim();

const fetchPage = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return {
    html,
    text: textFromHtml(html),
  };
};

const extractAttributeValues = (html, patterns) =>
  patterns.flatMap((pattern) => [...html.matchAll(pattern)].map((match) => match[1]));

const normalizeImageUrl = (rawUrl, pageUrl) => {
  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(decodeHtml(rawUrl).trim(), pageUrl).toString();
  } catch {
    return "";
  }
};

const extractImageUrl = (html, pageUrl) => {
  const attributeCandidates = extractAttributeValues(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/gi,
    /<img[^>]+src=["']([^"']+)["']/gi,
  ]);
  const urlCandidates = html.match(/https?:[^"'<>\\\s)]+(?:jpg|jpeg|png|webp)(?:\?[^"'<>\\\s)]*)?/gi) ?? [];
  const candidates = [...attributeCandidates, ...urlCandidates]
    .map((candidate) => normalizeImageUrl(candidate, pageUrl))
    .filter(Boolean)
    .filter((candidate) => !/ln-logo|facebook|instagram|youtube|wechat|weibo|logo|icon/i.test(candidate));
  const preferredNeedles = [
    "AsiaWorldExpoLocal",
    "upload_images",
    "organization_resource_files",
    "dynamicmedia.livenationinternational.com",
  ];

  return candidates.find((candidate) => preferredNeedles.some((needle) => candidate.includes(needle))) ?? candidates[0];
};

const localizeVenue = (venue) => {
  if (!venue) {
    return undefined;
  }

  if (/^(hong kong|香港)$/i.test(venue)) {
    return undefined;
  }

  if (/runway\s*11|hall\s*11|11號展館/i.test(venue)) {
    return "亞洲國際博覽館 Runway 11（11號展館）";
  }

  if (/asiaworld-arena|hall\s*1\b|1號展館/i.test(venue)) {
    return "亞洲國際博覽館 AsiaWorld-Arena（1號展館）";
  }

  if (/hall\s*10\b|10號展館/i.test(venue)) {
    return "亞洲國際博覽館 10號展館";
  }

  if (/hall\s*5\b|5號展館/i.test(venue)) {
    return "亞洲國際博覽館 5號展館";
  }

  if (/tides/i.test(venue)) {
    return "TIDES";
  }

  return venue;
};

const localizePrice = (price) =>
  price
    .replace(/All Standing/gi, "全場企位")
    .replace(/All seated/gi, "全場座位")
    .replace(/Standing/gi, "企位")
    .replace(/seated/gi, "座位")
    .replace(/restricted view/gi, "視線受阻")
    .replace(/general admission/gi, "普通企位")
    .replace(/priority entry/gi, "優先入場")
    .replace(/wheelchair/gi, "輪椅席")
    .replace(/General tickets from/gi, "普通門票")
    .replace(/VIP tickets from/gi, "VIP 門票")
    .replace(/\bfrom\s+/gi, "")
    .replace(/\bHKD\s*\$/gi, "HK$")
    .replace(/\s*;\s*/g, "；")
    .trim();

const isSpecificSoldOutLine = (line) => {
  if (/^(sold out|售罄|已售罄|售完|已售完)$/i.test(line)) {
    return true;
  }

  if (
    /(門票|票券|ticket|tickets).{0,24}(售罄|售完|sold out|no longer available|not available)|沒有可以購買|暫無票券|no tickets available|currently sold out/i.test(
      line,
    )
  ) {
    return true;
  }

  if (/once|when|until|if|如有|若有|售完即止|售罄即止|will be available|reserved/i.test(line)) {
    return false;
  }

  return /(sold out|售罄|售完|已滿)/i.test(line) && line.length <= 120;
};

const parseTicketStatus = (text) =>
  text
    .split("\n")
    .map(normalizeText)
    .filter(Boolean)
    .some(isSpecificSoldOutLine)
    ? "sold-out"
    : undefined;

const extractHeading = (html, fallbackText) => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (match) {
    return normalizeText(textFromHtml(match[1]));
  }

  return fallbackText.split("\n").find((line) => line.length > 8) ?? "";
};

const extractSection = (text, startPattern, endPattern) => {
  const start = text.search(startPattern);
  if (start === -1) {
    return "";
  }

  const afterStart = text.slice(start);
  const end = afterStart.search(endPattern);
  return normalizeText(end === -1 ? afterStart : afterStart.slice(0, end));
};

const isoDate = ({ year, month, day }) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const englishMonthDate = (day, monthName, year) => {
  const month = monthNumbers.get(monthName.toLowerCase());
  return month ? `${year}-${month}-${String(day).padStart(2, "0")}` : null;
};

const parseDates = (text) => {
  const range = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (range) {
    return [
      englishMonthDate(range[1], range[3], range[4]),
      englishMonthDate(range[2], range[3], range[4]),
    ].filter(Boolean);
  }

  const single = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (single) {
    return [englishMonthDate(single[1], single[2], single[3])].filter(Boolean);
  }

  const slash = text.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
  if (slash) {
    return [isoDate({ year: slash[1], month: slash[2], day: slash[3] })];
  }

  const chinese = text.match(/\b(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  return chinese ? [isoDate({ year: chinese[1], month: chinese[2], day: chinese[3] })] : [];
};

const parseClock = (rawHour, rawMinute = "00", rawMarker = "") => {
  let hour = Number(rawHour);
  const marker = rawMarker.toLowerCase();

  if ((marker === "pm" || marker.includes("下午")) && hour < 12) {
    hour += 12;
  }

  if ((marker === "am" || marker.includes("上午")) && hour === 12) {
    hour = 0;
  }

  return `${String(hour).padStart(2, "0")}:${String(rawMinute).padStart(2, "0")}`;
};

const parseShowTime = (text) => {
  const explicit = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (explicit) {
    return parseClock(explicit[1], explicit[2], explicit[3]);
  }

  const chinese = text.match(/(?:晚上|下午|上午)(\d{1,2})時/);
  if (chinese) {
    return parseClock(chinese[1], "00", chinese[0].slice(0, 2));
  }

  return undefined;
};

const parseSaleStart = (text) => {
  const saleText = extractSection(
    text,
    /Ticket Sales|TICKET SALES|Public Sale|公開發售/i,
    /Baggage|Dates And Times|場地公告|Admission|票區圖|How To Buy Tickets/i,
  );

  const english = saleText.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})[^.\n]*?(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm|nn|NN)\b/,
  );
  if (english) {
    const date = englishMonthDate(english[1], english[2], english[3]);
    const time = english[6].toLowerCase() === "nn" ? "12:00" : parseClock(english[4], english[5] ?? "00", english[6]);
    return date ? `${date}T${time}:00+08:00` : undefined;
  }

  const chinese = saleText.match(
    /\b(20\d{2})年(\d{1,2})月(\d{1,2})日[^.\n]*?(上午|下午|晚上)?(\d{1,2})時/,
  );
  if (chinese) {
    return `${isoDate({ year: chinese[1], month: chinese[2], day: chinese[3] })}T${parseClock(
      chinese[5],
      "00",
      chinese[4] ?? "",
    )}:00+08:00`;
  }

  return undefined;
};

const parseTicketingAgent = (text, fallback) => {
  const through = text.match(/through\s+([A-Za-z0-9 .-]+)\.?/i);
  if (through) {
    return normalizeText(through[1]).replace(/\s*Website.*$/i, "");
  }

  if (/KKTIX/i.test(text)) {
    return "KKTIX";
  }

  return fallback;
};

const parsePrice = (text) => {
  const section = extractSection(
    text,
    /Ticket Prices|TICKET PRICES|Ticket Price|門票價格/i,
    /Ticket Sales|TICKET SALES|Public Sale|公開發售|Age limit|觀眾年齡|Baggage|Dates And Times/i,
  );

  if (!section) {
    return undefined;
  }

  return localizePrice(
    section
    .replace(/^(Ticket Prices|TICKET PRICES|Ticket Price|門票價格)\s*/i, "")
    .replace(/\bHKD\s*\$/gi, "HK$")
    .replace(/\s*\/\s*/g, " / ")
      .trim(),
  );
};

const parseVenue = (text) => {
  const location = text.match(/Location\s+([^\n]+)/i);
  if (location) {
    return localizeVenue(normalizeText(location[1]));
  }

  const venue = text.match(/Venue\s+([^\n]*AsiaWorld[^\n]*)/i);
  return venue ? localizeVenue(normalizeText(venue[1])) : undefined;
};

const scrapeEvent = async (event) => {
  const { html, text } = await fetchPage(event.sourceUrl);
  const heading = extractHeading(html, text);
  const expectedNeedle = normalizeText(event.artist).toLowerCase();
  const eventStart = text.indexOf(heading);
  const eventScope = eventStart === -1 ? text : text.slice(eventStart, eventStart + 6_000);
  const eventInfoScope =
    extractSection(eventScope, /Event Information|節目資訊/i, /Public Sale|公開發售|Venue Notice|場地公告/i) ||
    eventScope;

  if (!text.toLowerCase().includes(expectedNeedle)) {
    throw new Error(`source page did not contain expected artist "${event.artist}"`);
  }

  let ticketPageText = "";
  let ticketPageImageUrl = "";

  if (event.ticketUrl && event.ticketUrl !== event.sourceUrl) {
    try {
      const ticketPage = await fetchPage(event.ticketUrl);
      ticketPageText = ticketPage.text;
      ticketPageImageUrl = extractImageUrl(ticketPage.html, event.ticketUrl) ?? "";
    } catch (error) {
      console.warn(
        `Ticket status page could not be parsed for ${event.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    title: heading,
    dates: parseDates(eventInfoScope),
    doors: parseShowTime(
      extractSection(eventScope, /Dates And Times|Show Time|演出時間/i, /Location|Venue|####/i) ||
        eventInfoScope,
    ),
    venue: parseVenue(eventScope),
    price: parsePrice(eventScope),
    generalSaleStart: parseSaleStart(eventScope),
    ticketingAgent: parseTicketingAgent(eventScope, event.ticketingAgent),
    status: parseTicketStatus(`${ticketPageText}\n${eventScope}`),
    imageUrl: extractImageUrl(html, event.sourceUrl) ?? ticketPageImageUrl,
  };
};

const daysBetween = (a, b) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

const isSaneDateReplacement = (currentDates, scrapedDates) => {
  if (!scrapedDates.length || scrapedDates.length !== currentDates.length) {
    return false;
  }

  return currentDates.every(
    (date, index) => daysBetween(`${date}T00:00:00+08:00`, `${scrapedDates[index]}T00:00:00+08:00`) <= 7,
  );
};

const isSaneSaleReplacement = (event, saleStart) => {
  if (!saleStart) {
    return false;
  }

  const saleTime = new Date(saleStart).getTime();
  const eventTime = new Date(`${event.dates[0]}T00:00:00+08:00`).getTime();
  const leadDays = (eventTime - saleTime) / 86_400_000;

  return leadDays >= 0 && leadDays <= 365;
};

const mergeScrape = (event, scraped, verifiedDate) => {
  const merged = {
    ...event,
    lastVerified: verifiedDate,
  };

  if (isSaneDateReplacement(event.dates, scraped.dates)) {
    merged.dates = scraped.dates;
  }

  if (isSaneSaleReplacement(event, scraped.generalSaleStart)) {
    merged.generalSaleStart = scraped.generalSaleStart;
  }

  if (scraped.status === "sold-out") {
    merged.status = "sold-out";
  }

  if (scraped.imageUrl) {
    merged.imageUrl = scraped.imageUrl;
    merged.imageAlt = event.imageAlt ?? `${event.artist} 香港演出主視覺`;
  }

  for (const key of ["doors", "venue", "price", "ticketingAgent"]) {
    if (Array.isArray(scraped[key]) ? scraped[key].length > 0 : scraped[key]) {
      merged[key] = scraped[key];
    }
  }

  return merged;
};

const verifiedDate = todayHongKong();
const syncedEvents = [];
const failures = [];

for (const event of seedConcerts) {
  try {
    const scraped = await scrapeEvent(event);
    syncedEvents.push(mergeScrape(event, scraped, verifiedDate));
  } catch (error) {
    failures.push({
      id: event.id,
      sourceUrl: event.sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    syncedEvents.push(event);
  }
}

console.table(
  syncedEvents.map((event) => ({
    id: event.id,
    status: event.status,
    dates: event.dates.join(", "),
    sale: event.generalSaleStart ?? "TBA",
    verified: event.lastVerified,
  })),
);

if (failures.length) {
  console.warn("Some sources could not be parsed. Existing curated data was kept for those rows.");
  console.table(failures);
}

if (dryRun) {
  console.log("Dry run complete. Firestore was not changed.");
} else {
  await writeConcerts({ events: syncedEvents });
}

process.exit(failures.length ? 1 : 0);
