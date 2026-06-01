import axios from "axios";
import type {
  Annotation,
  Document,
  HeatmapPoint,
  MetadataCandidate,
  Progress,
  ReadingSession,
  Shelf,
  StatsSummary,
  Tag,
  TimeseriesPoint,
} from "./types";

export const api = axios.create({ baseURL: "/api" });

export const coverUrl = (doc: Document, thumb = true) =>
  doc.cover_path ? `/api/documents/${doc.id}/cover${thumb ? "?thumb=true" : ""}` : null;

export const fileUrl = (id: number) => `/api/documents/${id}/file`;

// --- documents ---
export interface DocFilters {
  type?: string;
  shelf?: number;
  tag?: number;
  status?: string;
  q?: string;
  sort?: string;
}

export const listDocuments = async (filters: DocFilters = {}): Promise<Document[]> => {
  const { data } = await api.get("/documents", { params: filters });
  return data;
};

export const getDocument = async (id: number): Promise<Document> => {
  const { data } = await api.get(`/documents/${id}`);
  return data;
};

export const uploadDocument = async (file: File, docType: string): Promise<Document> => {
  const form = new FormData();
  form.append("file", file);
  form.append("doc_type", docType);
  const { data } = await api.post("/documents/upload", form);
  return data;
};

export const updateDocument = async (
  id: number,
  patch: Partial<Omit<Document, "authors" | "tags">> & { authors?: string[]; tags?: string[] },
): Promise<Document> => {
  const { data } = await api.patch(`/documents/${id}`, patch);
  return data;
};

export const deleteDocument = async (id: number, deleteFile = false) =>
  api.delete(`/documents/${id}`, { params: { delete_file: deleteFile } });

export const citationUrl = (id: number, format: string) =>
  `/api/documents/${id}/citation?format=${format}`;

export const annotatedFileUrl = (id: number) => `/api/documents/${id}/file/annotated`;

// --- notebook ---
export interface NotebookEntry {
  id: number;
  document_id: number;
  document_title: string;
  doc_type: string;
  kind: string;
  pdf_page: number | null;
  epub_cfi_range: string | null;
  selected_text: string | null;
  note: string | null;
  color: string | null;
  created_at: string | null;
}

export const getNotebook = async (kind?: string): Promise<NotebookEntry[]> => {
  const { data } = await api.get("/notebook", { params: { kind } });
  return data;
};
export const notebookExportUrl = () => "/api/notebook/export";

// --- progress ---
export const getProgress = async (id: number): Promise<Progress> => {
  const { data } = await api.get(`/documents/${id}/progress`);
  return data;
};

export const saveProgress = async (id: number, patch: Partial<Progress>): Promise<Progress> => {
  const { data } = await api.put(`/documents/${id}/progress`, patch);
  return data;
};

// --- sessions ---
export const startSession = async (documentId: number, percent?: number): Promise<ReadingSession> => {
  const { data } = await api.post("/sessions/start", { document_id: documentId, percent });
  return data;
};

export const pingSession = async (id: number, percent?: number, pagesRead?: number) =>
  api.post(`/sessions/${id}/ping`, { percent, pages_read: pagesRead });

export const endSessionBeacon = (id: number, percent?: number) => {
  const blob = new Blob([JSON.stringify({ percent })], { type: "application/json" });
  navigator.sendBeacon(`/api/sessions/${id}/end`, blob);
};

// --- stats ---
export const getStatsSummary = async (): Promise<StatsSummary> => {
  const { data } = await api.get("/stats/summary");
  return data;
};

export const getTimeseries = async (
  metric: string,
  granularity: string,
  days = 90,
): Promise<TimeseriesPoint[]> => {
  const { data } = await api.get("/stats/timeseries", { params: { metric, granularity, days } });
  return data;
};

export const getHeatmap = async (year?: number): Promise<HeatmapPoint[]> => {
  const { data } = await api.get("/stats/heatmap", { params: { year } });
  return data;
};

// --- shelves ---
export const listShelves = async (): Promise<Shelf[]> => {
  const { data } = await api.get("/shelves");
  return data;
};
export const createShelf = async (name: string, description?: string): Promise<Shelf> => {
  const { data } = await api.post("/shelves", { name, description });
  return data;
};
export const deleteShelf = async (id: number) => api.delete(`/shelves/${id}`);
export const addToShelf = async (shelfId: number, docId: number) =>
  api.post(`/shelves/${shelfId}/documents/${docId}`);
export const removeFromShelf = async (shelfId: number, docId: number) =>
  api.delete(`/shelves/${shelfId}/documents/${docId}`);

// --- tags ---
export const listTags = async (): Promise<Tag[]> => {
  const { data } = await api.get("/tags");
  return data;
};
export const setDocumentTags = async (docId: number, names: string[]): Promise<Tag[]> => {
  const { data } = await api.put(`/documents/${docId}/tags`, names);
  return data;
};

// --- search ---
export const search = async (q: string, type?: string): Promise<Document[]> => {
  const { data } = await api.get("/search", { params: { q, type } });
  return data;
};

// --- metadata ---
export const searchMetadata = async (params: {
  type: string;
  doi?: string;
  arxiv?: string;
  isbn?: string;
  query?: string;
}): Promise<MetadataCandidate[]> => {
  const { data } = await api.get("/metadata/search", { params });
  return data;
};
export const applyMetadata = async (docId: number, candidate: MetadataCandidate): Promise<Document> => {
  const { data } = await api.post(`/metadata/apply/${docId}`, candidate);
  return data;
};

// --- annotations ---
export const listAnnotations = async (docId: number, kind?: string): Promise<Annotation[]> => {
  const { data } = await api.get(`/documents/${docId}/annotations`, { params: { kind } });
  return data;
};
export const createAnnotation = async (
  docId: number,
  ann: Partial<Annotation>,
): Promise<Annotation> => {
  const { data } = await api.post(`/documents/${docId}/annotations`, ann);
  return data;
};
export const updateAnnotation = async (id: number, patch: Partial<Annotation>): Promise<Annotation> => {
  const { data } = await api.patch(`/annotations/${id}`, patch);
  return data;
};
export const deleteAnnotation = async (id: number) => api.delete(`/annotations/${id}`);
export const importEmbeddedAnnotations = async (
  docId: number,
): Promise<{ imported: number; skipped?: boolean; reason?: string }> => {
  const { data } = await api.post(`/documents/${docId}/annotations/import`);
  return data;
};

// --- import ---
export const getImportStatus = async () => {
  const { data } = await api.get("/import/status");
  return data;
};
export const triggerScan = async () => {
  const { data } = await api.post("/import/scan");
  return data;
};
