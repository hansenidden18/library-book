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
  const containerRef = useRef<HTMLDivElement>(null); // scroll container
  const innerRef = useRef<HTMLDivElement>(null); // pages container
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderedRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const currentPageRef = useRef(initialPage || 1);
  const annotationsRef = useRef<Annotation[]>([]);

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [color, setColor] = useState(HIGHLIGHT_COLORS[0]);
  const restored = useRef(false);
  const { reportProgress } = useReadingSession(doc.id);

  const outputScale = () => window.devicePixelRatio || 1;

  // Draw highlight overlays for a single rendered page.
  const drawPageAnnotations = useCallback((wrap: HTMLElement, n: number) => {
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
  }, []);

  const drawAllAnnotations = useCallback(() => {
    pageRefs.current.forEach((wrap, n) => {
      if (wrap && renderedRef.current.has(n)) drawPageAnnotations(wrap, n);
    });
  }, [drawPageAnnotations]);

  // Render one page's canvas + text layer (idempotent).
  const renderPage = useCallback(
    async (n: number) => {
      const pdf = pdfRef.current;
      const wrap = pageRefs.current[n];
      if (!pdf || !wrap || renderedRef.current.has(n)) return;
      renderedRef.current.add(n);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      const os = outputScale();
      wrap.style.width = `${Math.floor(viewport.width)}px`;
      wrap.style.height = `${Math.floor(viewport.height)}px`;
      wrap.innerHTML = "";

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * os);
      canvas.height = Math.floor(viewport.height * os);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      wrap.appendChild(canvas);

      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer";
      textLayerDiv.style.cssText = "position:absolute;inset:0;overflow:hidden;opacity:1;line-height:1;";
      wrap.appendChild(textLayerDiv);

      const annLayer = document.createElement("div");
      annLayer.className = "annLayer";
      annLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
      wrap.appendChild(annLayer);

      const ctx = canvas.getContext("2d")!;
      const transform = os !== 1 ? [os, 0, 0, os, 0, 0] : undefined;
      try {
        await page.render({
          canvasContext: ctx,
          viewport,
          transform,
          annotationMode: (pdfjsLib as any).AnnotationMode?.DISABLE ?? 0,
        }).promise;
        const textLayer = new (pdfjsLib as any).TextLayer({
          textContentSource: page.streamTextContent(),
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
      } catch {
        /* render may be cancelled */
      }
      drawPageAnnotations(wrap, n);
    },
    [scale, drawPageAnnotations],
  );

  // Tear a page back down to a placeholder to bound memory use.
  const unrenderPage = useCallback((n: number) => {
    const wrap = pageRefs.current[n];
    if (!wrap || !renderedRef.current.has(n)) return;
    renderedRef.current.delete(n);
    wrap.innerHTML = `<span class="placeholder">${n}</span>`;
  }, []);

  // Build placeholders for all pages and (re)wire the observer. Runs on load
  // and whenever the zoom changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdfRef.current) {
        pdfRef.current = await pdfjsLib.getDocument(fileUrl(doc.id)).promise;
        if (cancelled) return;
        setNumPages(pdfRef.current.numPages);
      }
      const pdf = pdfRef.current;
      const inner = innerRef.current!;
      const page1 = await pdf.getPage(1);
      const vp = page1.getViewport({ scale });

      observerRef.current?.disconnect();
      renderedRef.current.clear();
      inner.innerHTML = "";
      pageRefs.current = [];

      for (let n = 1; n <= pdf.numPages; n++) {
        const wrap = document.createElement("div");
        wrap.className = "lb-page relative mx-auto my-4 shadow-lg bg-white";
        wrap.style.width = `${Math.floor(vp.width)}px`;
        wrap.style.height = `${Math.floor(vp.height)}px`;
        wrap.dataset.page = String(n);
        wrap.style.setProperty("--scale-factor", String(scale));
        wrap.style.setProperty("--total-scale-factor", String(scale));
        wrap.innerHTML = `<span class="placeholder">${n}</span>`;
        inner.appendChild(wrap);
        pageRefs.current[n] = wrap;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) renderPage(n);
            else unrenderPage(n);
          }
        },
        { root: containerRef.current, rootMargin: "1200px 0px" },
      );
      pageRefs.current.forEach((w) => w && observer.observe(w));
      observerRef.current = observer;

      const target = restored.current ? currentPageRef.current : initialPage || 1;
      if (target > 1) pageRefs.current[target]?.scrollIntoView();
      restored.current = true;
    })();

    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, scale, renderPage, unrenderPage]);

  // Destroy the PDF on leaving the document.
  useEffect(() => {
    return () => {
      pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, [doc.id]);

  useEffect(() => {
    listAnnotations(doc.id).then(setAnnotations);
  }, [doc.id]);

  useEffect(() => {
    annotationsRef.current = annotations;
    drawAllAnnotations();
  }, [annotations, drawAllAnnotations]);

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

  // --- zoom ---
  const zoomBy = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s + delta).toFixed(2))));

  const fitWidth = async () => {
    const pdf = pdfRef.current;
    const container = containerRef.current;
    if (!pdf || !container) return;
    const page = await pdf.getPage(currentPageRef.current || 1);
    const unit = page.getViewport({ scale: 1 });
    const target = (container.clientWidth - 32) / unit.width;
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

  // --- pinch-to-zoom (touch) ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let startDist = 0;
    let startScale = scale;
    let pinching = false;

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    let lastRatio = 1;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinching = true;
        startDist = dist(e.touches);
        startScale = scale;
        lastRatio = 1;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (pinching && e.touches.length === 2) {
        e.preventDefault(); // stop the page from scrolling during a pinch
        lastRatio = dist(e.touches) / startDist;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (pinching && e.touches.length < 2) {
        pinching = false;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(startScale * lastRatio).toFixed(2)));
        if (Math.abs(next - scale) > 0.05) setScale(next);
        lastRatio = 1;
      }
    };

    container.addEventListener("touchstart", onStart, { passive: true });
    container.addEventListener("touchmove", onMove, { passive: false });
    container.addEventListener("touchend", onEnd);
    return () => {
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
    };
  }, [scale]);

  // --- highlight creation ---
  const handleHighlight = async () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
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
      <div className="h-12 shrink-0 border-b border-slate-800 flex items-center gap-2 px-3 sm:px-4 text-sm bg-[#0e1117] overflow-x-auto">
        <span className="text-slate-400 whitespace-nowrap">
          {currentPage} / {numPages || "..."}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => zoomBy(-0.2)} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200" title="Zoom out">
            -
          </button>
          <button onClick={() => setScale(DEFAULT_SCALE)} className="px-2 h-7 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 tabular-nums" title="Reset zoom">
            {Math.round((scale / DEFAULT_SCALE) * 100)}%
          </button>
          <button onClick={() => zoomBy(0.2)} className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-200" title="Zoom in">
            +
          </button>
          <button onClick={fitWidth} className="px-2 h-7 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300" title="Fit width">
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
          <button onClick={handleHighlight} className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs whitespace-nowrap">
            Highlight
          </button>
          <button onClick={addBookmark} className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs whitespace-nowrap">
            Bookmark
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-[#1a1d24] px-2 sm:px-4"
        style={{ touchAction: "pan-x pan-y" }}
      >
        <div ref={innerRef} />
      </div>
    </div>
  );
}
