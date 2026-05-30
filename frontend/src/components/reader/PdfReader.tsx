import { useCallback, useEffect, useRef, useState } from "react";
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

const DEFAULT_SCALE = 1.4;
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const HIGHLIGHT_COLORS = ["#fde047", "#86efac", "#93c5fd", "#fca5a5"];

interface Props {
  doc: Document;
  initialPage: number;
}

export default function PdfReader({ doc, initialPage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const currentPageRef = useRef(initialPage || 1);
  const annotationsRef = useRef<Annotation[]>([]);
  const drawRef = useRef<() => void>(() => {});
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [color, setColor] = useState(HIGHLIGHT_COLORS[0]);
  const restored = useRef(false);
  const { reportProgress } = useReadingSession(doc.id);

  // Load the PDF once, then (re)render all pages whenever the zoom changes.
  // Rendering uses devicePixelRatio so pages stay crisp on Retina displays.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!pdfRef.current) {
        pdfRef.current = await pdfjsLib.getDocument(fileUrl(doc.id)).promise;
        if (cancelled) return;
        setNumPages(pdfRef.current.numPages);
      }
      const pdf = pdfRef.current;
      const outputScale = window.devicePixelRatio || 1;
      const container = containerRef.current!;
      container.innerHTML = "";
      pageRefs.current = [];

      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });

        const wrap = document.createElement("div");
        wrap.className = "relative mx-auto my-4 shadow-lg";
        wrap.style.width = `${Math.floor(viewport.width)}px`;
        wrap.style.height = `${Math.floor(viewport.height)}px`;
        wrap.dataset.page = String(n);
        // pdf.js positions the text layer using these CSS variables; without
        // them the selectable text is mis-scaled and offset from the glyphs.
        wrap.style.setProperty("--scale-factor", String(scale));
        wrap.style.setProperty("--total-scale-factor", String(scale));

        const canvas = document.createElement("canvas");
        // Backing store at full device resolution; CSS size at logical size.
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        wrap.appendChild(canvas);

        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        textLayerDiv.style.cssText = `position:absolute;inset:0;overflow:hidden;opacity:1;line-height:1;`;
        wrap.appendChild(textLayerDiv);

        const annLayer = document.createElement("div");
        annLayer.className = "annLayer";
        // Above the text layer (z-index 2) so highlight rects are clickable;
        // the layer itself is pass-through, only the rects capture clicks.
        annLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
        wrap.appendChild(annLayer);

        container.appendChild(wrap);
        pageRefs.current[n] = wrap;

        const ctx = canvas.getContext("2d")!;
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        await page.render({
          canvasContext: ctx,
          viewport,
          transform,
          // Don't draw embedded annotations onto the canvas: highlights/notes
          // are imported into the app and drawn as managed overlays, so canvas
          // rendering here would double them up.
          annotationMode: (pdfjsLib as any).AnnotationMode?.DISABLE ?? 0,
        }).promise;

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

      // Keep the reader on the same page across the initial restore and zoom.
      const target = restored.current ? currentPageRef.current : initialPage || 1;
      if (target > 1) pageRefs.current[target]?.scrollIntoView();
      restored.current = true;

      // Pages exist now -> draw any saved highlight overlays.
      drawRef.current();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, scale]);

  // Destroy the PDF when leaving the document.
  useEffect(() => {
    return () => {
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
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
      currentPageRef.current = page;
      const percent = numPages > 0 ? Math.min(100, (page / numPages) * 100) : 0;
      reportProgress({ pdf_page: page, percent });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [numPages, reportProgress]);

  // Zoom helpers (buttons, keyboard, and ctrl/cmd + wheel).
  const zoomBy = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s + delta).toFixed(2))));

  const fitWidth = async () => {
    const pdf = pdfRef.current;
    const container = containerRef.current;
    if (!pdf || !container) return;
    const page = await pdf.getPage(currentPageRef.current || 1);
    const unit = page.getViewport({ scale: 1 });
    const target = (container.clientWidth - 48) / unit.width; // minus padding
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, +target.toFixed(2))));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomBy(0.2);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomBy(-0.2);
      } else if (e.key === "0") {
        e.preventDefault();
        setScale(DEFAULT_SCALE);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Draw saved highlight overlays onto the (already-built) page layers.
  const drawAnnotations = useCallback(() => {
    pageRefs.current.forEach((wrap, n) => {
      if (!wrap) return;
      const layer = wrap.querySelector(".annLayer") as HTMLDivElement | null;
      if (!layer) return;
      layer.innerHTML = "";
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      annotationsRef.current
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
    });
  }, []);

  // Keep refs current and redraw whenever annotations, page count, or zoom change.
  useEffect(() => {
    annotationsRef.current = annotations;
    drawRef.current = drawAnnotations;
    drawAnnotations();
  }, [annotations, numPages, scale, drawAnnotations]);

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
        <span className="text-slate-400 whitespace-nowrap">
          Page {currentPage} / {numPages || "..."}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoomBy(-0.2)}
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Zoom out (Ctrl/Cmd -)"
          >
            -
          </button>
          <button
            onClick={() => setScale(DEFAULT_SCALE)}
            className="px-2 h-7 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 tabular-nums"
            title="Reset zoom (Ctrl/Cmd 0)"
          >
            {Math.round((scale / DEFAULT_SCALE) * 100)}%
          </button>
          <button
            onClick={() => zoomBy(0.2)}
            className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Zoom in (Ctrl/Cmd +)"
          >
            +
          </button>
          <button
            onClick={fitWidth}
            className="px-2 h-7 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
            title="Fit width"
          >
            Fit
          </button>
        </div>
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
