export type PcoCollection<T> = {
  data: T[];
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
