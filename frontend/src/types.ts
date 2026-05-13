export type BinCategory = "RECYCLABLE" | "COMPOST" | "TRASH" | "HAZARDOUS" | "HUMAN" | "PENDING";

export interface ClassificationResult {
  item_identified: string;
  category: BinCategory;
  confidence: number;
  is_contaminated: boolean;
  contamination_details: string;
  reasoning: string;
  bin_action: string;
  education_tip: string;
  color: string;
  icon: string;
  timestamp: string;
  processing_time_ms: number;
  pun?: string;
  appreciation_message?: string;
  needs_confirmation?: boolean;
  confirmation_question?: string;
}

export interface LidStates {
  RECYCLABLE: boolean;
  COMPOST: boolean;
  TRASH: boolean;
  HAZARDOUS: boolean;
}

export interface StatsData {
  total_items: number;
  category_counts: Record<string, number>;
  contamination_rate: number;
  recyclable_pct: number;
  compost_pct: number;
  trash_pct: number;
  hazardous_pct: number;
}

export interface WasteEvent {
  id: number;
  item_description: string;
  category: string;
  confidence: number;
  is_contaminated: boolean;
  bin_action: string;
  created_at: string;
}
