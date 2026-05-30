export interface Author {
  id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface Progress {
  document_id: number;
  pdf_page: number | null;
  epub_cfi: string | null;
  scroll_offset: number | null;
  percent: number;
  status: "unread" | "reading" | "finished";
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
}

export interface Document {
  id: number;
  doc_type: "book" | "paper";
  file_format: "pdf" | "epub";
  title: string;
  subtitle: string | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  published_date: string | null;
  page_count: number | null;
  isbn10: string | null;
  isbn13: string | null;
  series: string | null;
  series_index: number | null;
  doi: string | null;
  arxiv_id: string | null;
  venue: string | null;
  year: number | null;
  file_size: number | null;
  cover_path: string | null;
  added_at: string;
  updated_at: string;
  metadata_source: string | null;
  metadata_locked: boolean;
  authors: Author[];
  tags: Tag[];
  progress: Progress | null;
}

export interface Shelf {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  document_count: number;
}

export interface Annotation {
  id: number;
  document_id: number;
  kind: "highlight" | "bookmark" | "note";
  pdf_page: number | null;
  pdf_rects: { x: number; y: number; w: number; h: number }[] | null;
  epub_cfi_range: string | null;
  selected_text: string | null;
  note: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatsSummary {
  total_minutes: number;
  total_sessions: number;
  documents_started: number;
  documents_finished: number;
  current_streak: number;
  longest_streak: number;
  minutes_today: number;
  minutes_this_week: number;
}

export interface TimeseriesPoint {
  bucket: string;
  value: number;
}

export interface HeatmapPoint {
  date: string;
  minutes: number;
}

export interface MetadataCandidate {
  source: string;
  doc_type: "book" | "paper";
  title: string | null;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  publisher: string | null;
  published_date: string | null;
  language: string | null;
  isbn10: string | null;
  isbn13: string | null;
  doi: string | null;
  arxiv_id: string | null;
  venue: string | null;
  year: number | null;
  cover_url: string | null;
  external_id: string | null;
}

export interface ReadingSession {
  id: number;
  document_id: number;
  started_at: string;
  duration_sec: number;
}
