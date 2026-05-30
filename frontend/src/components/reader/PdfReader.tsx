import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-expect-error - vite ?url import for the worker
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  createAnnotation,
  deleteAnnotation,
  fileUrl,
  listAnnotations,
} from "../../api/client";
import type { Annotation, Document } from "../../api/types";
import { useReadingSession } from "../../hooks/useReadingSession";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.4;
const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#93c5fd", "#fca5a5"];

interface Props {
  doc: Document;
  initialPage: number;
}

export default function PdfReader({ doc, initialPage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [color, setColor] = useState(HIGHLIGHT_COLORS[0]);
  const restored = useRef(false);
  const { reportProgress } = useReadingSession(doc.id);

  // Load + render the PDF.
  useEffect(() => {
    let pdf: pdfjsLib.PDFDocumentProxy | null = null;
    let cancelled = false;

    (async () => {
      const task = pdfjsLib.getDocument(fileUrl(doc.id));
      pdf = await task.promise;
      if (cancelled) return;
      setNumPages(pdf.numPages);
      const container = containerRef.current!;
      container.innerHTML = "";
      pageRefs.current = [];

      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: SCALE });

        const wrap = document.createElement("div");
        wrap.className = "relative mx-auto my-4 shadow-lg";
        wrap.style.width = `${viewport.width}px`;
        wrap.style.height = `${viewport.height}px`;
        wrap.dataset.page = String(n);

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        wrap.appendChild(canvas);

        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        textLayerDiv.style.cssText = `position:absolute;inset:0;overflow:hidden;opacity:1;line-height:1;`;
        wrap.appendChild(textLayerDiv);

        const annLayer = document.createElement("div");
        annLayer.className = "annLayer";
        annLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
        wrap.appendChild(annLayer);

        container.appendChild(wrap);
        pageRefs.current[n] = wrap;

        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        // Text layer for selection.
        try {
          const textLayer = new (pdfjsLib as any).TextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerDiv,
            viewport,
          });
          await textLayer.render();
        } catch {
          /* text layer is best-effort */
        }
      }

      if (!restored.current && initialPage > 1) {
        pageRefs.current[initialPage]?.scrollIntoView();
        restored.current = true;
      }
    })();

    return () => {
      cancelled = true;
      pdf?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Load annotations.
  useEffect(() => {
    listAnnotations(doc.id).then(setAnnotations);
  }, [doc.id]);

  // Track scroll -> current page + progress.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const mid = container.scrollTop + container.clientHeight / 2;
      let page = 1;
      for (let n = 1; n <= numPages; n++) {
        const wrap = pageRefs.current[n];
        if (wrap && wrap.offsetTop <= mid) page = n;
      }
      setCurrentPage(page);
      const percent = numPages > 0 ? Math.min(100, (page / numPages) * 100) : 0;
      reportProgress({ pdf_page: page, percent });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [numPages, reportProgress]);

  // Render highlight overlays whenever annotations change.
  useEffect(() => {
    for (let n = 1; n <= numPages; n++) {
      const wrap = pageRefs.current[n];
      if (!wrap) continue;
      const layer = wrap.querySelector(".annLayer") as HTMLDivElement | null;
      if (!layer) continue;
      layer.innerHTML = "";
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      annotations
        .filter((a) => a.pdf_page === n && a.pdf_rects)
        .forEach((a) => {
          a.pdf_rects!.forEach((r) => {
            const div = document.createElement("div");
            div.style.cssText = `position:absolute;left:${r.x * w}px;top:${r.y * h}px;width:${r.w * w}px;height:${r.h * h}px;background:${a.color || "#fde047"};opacity:.35;pointer-events:auto;cursor:pointer;border-radius:2px;`;
            div.title = a.note || a.selected_text || "highlight (click to delete)";
            div.onclick = async () => {
              if (confirm("Delete this highlight?")) {
                await deleteAnnotation(a.id);
                setAnnotations((prev) => prev.filter((x) => x.id !== a.id));
              }
            };
            layer.appendChild(div);
          });
        });
    }
  }, [annotations, numPages]);

  const handleHighlight = async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Find which page wrapper the selection starts in.
    let node: Node | null = range.startContainer;
    let wrap: HTMLElement | null = null;
    while (node) {
      if (node instanceof HTMLElement && node.dataset.page) {
        wrap = node;
        break;
      }
      node = node.parentNode;
    }
    if (!wrap) return;
    const page = Number(wrap.dataset.page);
    const base = wrap.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: (r.left - base.left) / base.width,
        y: (r.top - base.top) / base.height,
        w: r.width / base.width,
        h: r.height / base.height,
      }));
    if (rects.length === 0) return;

    const ann = await createAnnotation(doc.id, {
      kind: "highlight",
      pdf_page: page,
      pdf_rects: rects,
      selected_text: sel.toString(),
      color,
    });
    setAnnotations((prev) => [...prev, ann]);
    sel.removeAllRanges();
  };

  const addBookmark = async () => {
    const ann = await createAnnotation(doc.id, { kind: "bookmark", pdf_page: currentPage });
    setAnnotations((prev) => [...prev, ann]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center gap-3 px-4 text-sm bg-[#0e1117]">
        <span className="text-slate-400">
          Page {currentPage} / {numPages || "..."}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`}
              style={{ background: c }}
              title="Highlight color"
            />
          ))}
          <button
            onClick={handleHighlight}
            className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
          >
            Highlight selection
          </button>
          <button
            onClick={addBookmark}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs"
          >
            Bookmark page
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto bg-[#1a1d24] px-4" />
    </div>
  );
}
