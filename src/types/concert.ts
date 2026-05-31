export type TicketStatus = "on-sale" | "soon" | "sold-out" | "watching" | "past";

export type SourceConfidence = "official" | "promoter" | "ticketing" | "venue";

export type DataQuality = "verified" | "partial";

export type ConcertEvent = {
  id: string;
  artist: string;
  artistJa?: string;
  tour: string;
  dates: string[];
  doors?: string;
  venue: string;
  district: string;
  city: "Hong Kong";
  genres: string[];
  status: TicketStatus;
  price?: string;
  presaleStart?: string;
  generalSaleStart?: string;
  ticketingAgent?: string;
  ticketUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  sourceUrl: string;
  sourceName: string;
  sourceConfidence: SourceConfidence;
  dataQuality: DataQuality;
  lastVerified: string;
  notes?: string;
};

export type ConcertSource = {
  id: string;
  name: string;
  url: string;
  kind: "venue" | "promoter" | "ticketing" | "discovery";
  authority: "canonical" | "confirmation" | "discovery";
  cadence: "daily" | "twice-weekly" | "weekly";
  priority: "high" | "medium";
};

export type SourceSyncStatus = "success" | "partial" | "failed";

export type SyncMetadata = {
  id?: string;
  status: SourceSyncStatus;
  lastRunAt: string;
  lastUpdatedAt: string;
  lastVerified: string;
  eventCount: number;
  failureCount: number;
  sourceCount: number;
};
