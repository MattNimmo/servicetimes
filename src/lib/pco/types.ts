export type PcoCollection<T, I = never> = {
  data: T[];
  included?: I[];
  links?: {
    next?: string | null;
    self?: string;
  };
  meta?: {
    count?: number;
    total_count?: number;
    next?: {
      offset?: number;
    } | null;
  };
};

export type PcoRelationship = {
  data:
    | { type: string; id: string }
    | Array<{ type: string; id: string }>
    | null;
};

export type PcoPlan = {
  type: "Plan";
  id: string;
  attributes: {
    title: string | null;
    series_title: string | null;
    sort_date: string;
    total_length: number;
    updated_at?: string;
  };
};

export type PcoPlanTime = {
  type: "PlanTime";
  id: string;
  attributes: {
    starts_at: string | null;
    ends_at: string | null;
    live_starts_at: string | null;
    live_ends_at: string | null;
    name: string | null;
    recorded: boolean;
    time_type: "rehearsal" | "service" | "other";
  };
};

export type PcoItem = {
  type: "Item";
  id: string;
  attributes: {
    title: string;
    item_type: "song" | "header" | "media" | "item";
    length: number;
    sequence: number;
    service_position: "pre" | "during" | "post" | null;
  };
  relationships?: Record<string, PcoRelationship>;
};

export type PcoItemTime = {
  type: "ItemTime";
  id: string;
  attributes: {
    exclude: boolean;
    length: number;
    length_offset: number;
    live_start_at: string | null;
    live_end_at: string | null;
  };
  relationships: {
    item: PcoRelationship;
    plan_time: PcoRelationship;
    plan: PcoRelationship;
  };
};

export type PcoServiceType = {
  type: "ServiceType";
  id: string;
  attributes: {
    archived_at: string | null;
    name: string;
    permissions: string;
    sequence: number;
  };
};
