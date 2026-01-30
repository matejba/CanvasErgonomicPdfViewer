import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

const BUILD = "PDF_2026-01-29_FINAL";

interface PDFDocumentProxy {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
}

interface PDFPageProxy {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
}

interface PdfJsModule {
  version?: string;
  build?: string;
  getDocument: (src: { data: Uint8Array; disableWorker?: boolean }) => { promise: Promise<PDFDocumentProxy> };
  GlobalWorkerOptions?: { workerSrc?: string };
}

export class CanvasErgonomicPdfViewer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private pdfjs: PdfJsModule | null = null;

  private async getPdfJs(): Promise<PdfJsModule> {
    if (this.pdfjs) return this.pdfjs;

    const m = pdfjsLib as unknown as PdfJsModule;
    
    if (!m.GlobalWorkerOptions) {
      m.GlobalWorkerOptions = { workerSrc: "" };
    }
    
    const version = m.version || "5.4.530";
    
    if (typeof pdfjsWorker === 'string') {
      m.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    } else {
      const cdnUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
      m.GlobalWorkerOptions.workerSrc = cdnUrl;
    }

    this.pdfjs = m;
    return this.pdfjs;
  }

  private host!: HTMLDivElement;
  private root!: HTMLDivElement;
  private toolbar!: HTMLDivElement;

  private btnPrev!: HTMLButtonElement;
  private btnNext!: HTMLButtonElement;
  private pageLabel!: HTMLDivElement;

  private zoomLabel!: HTMLDivElement;
  private btnResetFit!: HTMLButtonElement;

  private viewport!: HTMLDivElement;
  private pagesHost!: HTMLDivElement;

  private overlay!: HTMLDivElement;
  private overlayText!: HTMLDivElement;
  private errorBox!: HTMLDivElement;

  private resizeObserver: ResizeObserver | null = null;

  private doc: PDFDocumentProxy | null = null;
  private pages: PDFPageProxy[] = [];
  private pageCanvases: HTMLCanvasElement[] = [];
  private pageWrappers: HTMLDivElement[] = [];
  private lastDataUri: string | null = null;

  private minZoom = 0.5;
  private maxZoom = 3.0;
  private zoomStep = 0.1;
  private showToolbar = true;
  private resetOnSourceChange = true;
  private fitButtonText = "Fit";
  private fitButtonWidth: number | null = null;

  private currentScale = 1;
  private fitWidthScale = 1;

  private renderToken = 0;


  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartScrollLeft = 0;
  private panStartScrollTop = 0;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this.host = container;

    this.root = document.createElement("div");
    this.root.style.width = "100%";
    this.root.style.height = "100%";
    this.root.style.minHeight = "0";
    this.root.style.boxSizing = "border-box";
    this.root.style.display = "flex";
    this.root.style.flexDirection = "column";
    this.root.style.fontFamily =
      "Segoe UI, system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

    this.viewport = document.createElement("div");
    this.viewport.style.flex = "1 1 auto";
    this.viewport.style.minHeight = "0";
    this.viewport.style.position = "relative";
    this.viewport.style.overflow = "auto";
    this.viewport.style.background = "#f6f6f6";
    this.viewport.style.boxSizing = "border-box";

    this.pagesHost = document.createElement("div");
    this.pagesHost.style.position = "relative";
    this.pagesHost.style.display = "flex";
    this.pagesHost.style.flexDirection = "column";
    this.pagesHost.style.alignItems = "flex-start";
    this.pagesHost.style.gap = "12px";
    this.pagesHost.style.padding = "12px";
    this.pagesHost.style.boxSizing = "border-box";
    this.pagesHost.style.minWidth = "100%";

    this.viewport.appendChild(this.pagesHost);

    this.overlay = document.createElement("div");
    this.overlay.style.position = "absolute";
    this.overlay.style.inset = "0";
    this.overlay.style.display = "none";
    this.overlay.style.alignItems = "center";
    this.overlay.style.justifyContent = "center";
    this.overlay.style.background = "rgba(246,246,246,0.65)";
    this.overlay.style.backdropFilter = "none";
    this.overlay.style.zIndex = "10";

    this.overlayText = document.createElement("div");
    this.overlayText.style.fontSize = "12px";
    this.overlayText.style.color = "#444";
    this.overlayText.style.padding = "8px 10px";
    this.overlayText.style.border = "1px solid #e0e0e0";
    this.overlayText.style.borderRadius = "10px";
    this.overlayText.style.background = "#fff";
    this.overlayText.innerText = "Loading…";

    this.overlay.appendChild(this.overlayText);
    this.viewport.appendChild(this.overlay);

    this.errorBox = document.createElement("div");
    this.errorBox.style.position = "absolute";
    this.errorBox.style.left = "12px";
    this.errorBox.style.top = "12px";
    this.errorBox.style.right = "12px";
    this.errorBox.style.display = "none";
    this.errorBox.style.padding = "10px 12px";
    this.errorBox.style.borderRadius = "10px";
    this.errorBox.style.border = "1px solid #f1cccc";
    this.errorBox.style.background = "#fff6f6";
    this.errorBox.style.color = "#8a1f1f";
    this.errorBox.style.fontSize = "12px";
    this.errorBox.style.boxSizing = "border-box";
    this.errorBox.style.zIndex = "11";

    this.viewport.appendChild(this.errorBox);

    this.toolbar = document.createElement("div");
    this.toolbar.style.display = "flex";
    this.toolbar.style.alignItems = "center";
    this.toolbar.style.justifyContent = "space-between";
    this.toolbar.style.gap = "6px";
    this.toolbar.style.padding = "6px 8px";
    this.toolbar.style.borderTop = "1px solid #e6e6e6";
    this.toolbar.style.background = "#fff";
    this.toolbar.style.boxSizing = "border-box";
    this.toolbar.style.flexShrink = "0";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "4px";
    left.style.minWidth = "0";

    this.btnPrev = this.createIconButton("Previous page", "M15 18l-6-6 6-6");
    this.btnNext = this.createIconButton("Next page", "M9 6l6 6-6 6");

    this.pageLabel = document.createElement("div");
    this.pageLabel.style.fontSize = "12px";
    this.pageLabel.style.color = "#555";
    this.pageLabel.style.whiteSpace = "nowrap";
    this.pageLabel.innerText = "0 / 0";

    left.appendChild(this.btnPrev);
    left.appendChild(this.btnNext);
    left.appendChild(this.pageLabel);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "6px";
    right.style.minWidth = "0";

    this.zoomLabel = document.createElement("div");
    this.zoomLabel.style.fontSize = "12px";
    this.zoomLabel.style.color = "#555";
    this.zoomLabel.style.whiteSpace = "nowrap";
    this.zoomLabel.style.minWidth = "38px";
    this.zoomLabel.style.textAlign = "right";
    this.zoomLabel.innerText = "100%";

    this.btnResetFit = this.createTextButton(this.fitButtonText);
    this.btnResetFit.title = "Fit to width";

    right.appendChild(this.zoomLabel);
    right.appendChild(this.btnResetFit);

    this.toolbar.appendChild(left);
    this.toolbar.appendChild(right);

    this.root.appendChild(this.viewport);
    this.root.appendChild(this.toolbar);
    this.host.appendChild(this.root);

    this.wireEvents();

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.host);

    requestAnimationFrame(() => {
      this.applyToolbarVisibility();
      this.updateZoomUi();
      this.updateNavUi();
    });
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const dataUri = (context.parameters.pdfDataUri.raw || "").trim();

    this.showToolbar = context.parameters.showToolbar.raw ?? true;

    this.minZoom = this.clampNumber(context.parameters.minZoom.raw ?? 0.5, 0.1, 5);
    this.maxZoom = this.clampNumber(context.parameters.maxZoom.raw ?? 3.0, this.minZoom, 10);
    this.zoomStep = this.clampNumber(context.parameters.zoomStep.raw ?? 0.1, 0.01, 1);

    this.resetOnSourceChange = context.parameters.resetToFitOnSourceChange.raw ?? true;

    // Fit button customization
    const newFitText = (context.parameters.fitButtonText?.raw || "").trim() || "Fit";
    const newFitWidth = context.parameters.fitButtonWidth?.raw ?? null;

    if (this.fitButtonText !== newFitText) {
      this.fitButtonText = newFitText;
      this.btnResetFit.innerText = this.fitButtonText;
    }

    if (this.fitButtonWidth !== newFitWidth) {
      this.fitButtonWidth = newFitWidth;
      if (this.fitButtonWidth && this.fitButtonWidth > 0) {
        this.btnResetFit.style.width = `${this.fitButtonWidth}px`;
        this.btnResetFit.style.padding = "0 4px";
      } else {
        this.btnResetFit.style.width = "";
        this.btnResetFit.style.padding = "0 14px";
      }
    }

    this.applyToolbarVisibility();

    const changed = dataUri !== (this.lastDataUri || "");
    if (changed) {
      this.lastDataUri = dataUri;
      void this.loadFromDataUri(dataUri);
    } else {
      this.onResize();
    }
  }

  public getOutputs(): IOutputs {
    return {};
  }

public destroy(): void {
    this.renderToken++;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.unwireEvents();

    this.doc = null;
    this.pages = [];
    this.pageCanvases = [];
    this.pageWrappers = [];

    this.root?.parentElement?.removeChild(this.root);
  }

  private async loadFromDataUri(dataUri: string): Promise<void> {
    const token = ++this.renderToken;
    this.clearError();

    const raw = (dataUri || "").trim();
    if (!raw || raw.length < 20) {
      this.clearDocument();
      return;
    }

    this.setLoading(true);

    try {
      const bytes = this.dataUriToBytes(raw);

      const sig = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
      if (sig !== "%PDF") {
        this.clearDocument();
        this.setError(`Not a PDF. Signature: ${sig}`);
        return;
      }

      if (token !== this.renderToken) return;

      const pdfjsLib = await this.getPdfJs();
      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const doc = await loadingTask.promise;

      if (token !== this.renderToken) return;

      this.doc = doc;
      this.pages = [];
      this.pageCanvases = [];
      this.pageWrappers = [];
      this.pagesHost.innerHTML = "";

      const pageCount = doc.numPages || 0;
      for (let i = 1; i <= pageCount; i++) {
    if (token !== this.renderToken) return;
    const page = await doc.getPage(i);
    this.pages.push(page);
  }

  // ✅ Vykreslíme stránky NEJDŘÍV s neutrálním scale
  this.currentScale = 1;
  await this.renderAllPages(token);
  if (token !== this.renderToken) return;

  // ✅ PAK teprve spočítáme fit a re-renderujeme
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  
 this.computeFitWidthScale();
  this.currentScale = this.fitWidthScale;
  this.viewport.scrollTop = 0;
  this.viewport.scrollLeft = 0;

  await this.renderAllPages(token);
  if (token !== this.renderToken) return;

  this.updateNavUi();
  this.updateZoomUi();

    } catch (e: unknown) {
      if (token !== this.renderToken) return;
      const msg = e instanceof Error ? (e.message || String(e)) : String(e);
      this.clearDocument();
      this.setError(`Failed to load PDF: ${msg}`);
    } finally {
      if (token === this.renderToken) this.setLoading(false);
    }
  }

  private clearDocument(): void {
    this.doc = null;
    this.pages = [];
    this.pageCanvases = [];
    this.pageWrappers = [];
    this.pagesHost.innerHTML = "";
    this.pageLabel.innerText = "0 / 0";
    this.zoomLabel.innerText = "100%";
  }

private async renderAllPages(token: number): Promise<void> {
  this.pagesHost.innerHTML = "";
  this.pageCanvases = [];
  this.pageWrappers = [];

  for (const page of this.pages) {
    if (token !== this.renderToken) return;

    const wrapper = document.createElement("div");
    wrapper.style.background = "#fff";
    wrapper.style.borderRadius = "10px";
    wrapper.style.boxShadow = "0 2px 10px rgba(0,0,0,0.06)";
    wrapper.style.border = "1px solid #eee";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.padding = "0";
    wrapper.style.overflow = "hidden";
    wrapper.style.display = "inline-block";
    wrapper.style.marginLeft = "auto";
    wrapper.style.marginRight = "auto";

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.borderRadius = "10px"; // ✅ změněno z "6px" na "10px"

    wrapper.appendChild(canvas);
    this.pagesHost.appendChild(wrapper);

    this.pageWrappers.push(wrapper);
    this.pageCanvases.push(canvas);

    await this.renderPageToCanvas(page, canvas, this.currentScale, token);
  }
}
  private async renderPageToCanvas(
    page: PDFPageProxy,
    canvas: HTMLCanvasElement,
    scale: number,
    token: number
  ): Promise<void> {
    if (token !== this.renderToken) return;

    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;

    const w = Math.floor(viewport.width * outputScale);
    const h = Math.floor(viewport.height * outputScale);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    canvas.width = w;
    canvas.height = h;

    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

    const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
    await renderTask.promise;
  }

  private computeFitWidthScale(): void {
    if (!this.pages.length) {
      this.fitWidthScale = 1;
      return;
    }

    const hostWidth = this.viewport.clientWidth;
    const usable = Math.max(200, hostWidth - 24);

    const first = this.pages[0];
    const vp1 = first.getViewport({ scale: 1 });

    const fit = usable / Math.max(1, vp1.width);
    this.fitWidthScale = this.clampNumber(fit, this.minZoom, this.maxZoom);
  }

  private async applyScale(scale: number): Promise<void> {
    if (!this.doc || !this.pages.length) return;

    const token = ++this.renderToken;

    const ratioTop =
      this.viewport.scrollHeight > this.viewport.clientHeight
        ? this.viewport.scrollTop / (this.viewport.scrollHeight - this.viewport.clientHeight)
        : 0;

    const ratioLeft =
      this.viewport.scrollWidth > this.viewport.clientWidth
        ? this.viewport.scrollLeft / (this.viewport.scrollWidth - this.viewport.clientWidth)
        : 0;

    this.setLoading(true);

    try {
      await this.renderAllPages(token);
      if (token !== this.renderToken) return;

      requestAnimationFrame(() => {
        const maxTop = Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight);
        const maxLeft = Math.max(0, this.viewport.scrollWidth - this.viewport.clientWidth);
        this.viewport.scrollTop = Math.floor(maxTop * ratioTop);
        this.viewport.scrollLeft = Math.floor(maxLeft * ratioLeft);
      });

      this.updateNavUi();
      this.updateZoomUi();
    } finally {
      if (token === this.renderToken) this.setLoading(false);
    }
  }






  private setScale(scale: number, opts?: { rerender?: boolean }): void {
    this.currentScale = this.clampNumber(scale, this.minZoom, this.maxZoom);
    this.updateZoomUi();

    const rerender = opts?.rerender ?? true;
    if (rerender) void this.applyScale(this.currentScale);
  }

  private onResize(): void {
    if (!this.pages.length) return;

    const beforeFit = this.fitWidthScale;
    this.computeFitWidthScale();

    const epsilon = 0.02;
    if (Math.abs(this.currentScale - beforeFit) <= epsilon) {
      this.setScale(this.fitWidthScale);
    }
  }

  private wireEvents(): void {
    this.btnPrev.addEventListener("click", this.onPrevClick);
    this.btnNext.addEventListener("click", this.onNextClick);
    this.btnResetFit.addEventListener("click", this.onResetFit);

    this.viewport.addEventListener("scroll", this.onViewportScroll, { passive: true });
    document.addEventListener("wheel", this.onWheel, { passive: false });

    this.viewport.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  private unwireEvents(): void {
    this.btnPrev.removeEventListener("click", this.onPrevClick);
    this.btnNext.removeEventListener("click", this.onNextClick);
    this.btnResetFit.removeEventListener("click", this.onResetFit);

    this.viewport.removeEventListener("scroll", this.onViewportScroll as EventListener);
    document.removeEventListener("wheel", this.onWheel as EventListener);

    this.viewport.removeEventListener("mousedown", this.onMouseDown as EventListener);
    window.removeEventListener("mousemove", this.onMouseMove as EventListener);
    window.removeEventListener("mouseup", this.onMouseUp as EventListener);
  }

  private onPrevClick = (): void => {
    const idx = this.getCurrentPageIndex();
    this.scrollToPage(Math.max(0, idx - 1));
  };

  private onNextClick = (): void => {
    const idx = this.getCurrentPageIndex();
    this.scrollToPage(Math.min(this.pageWrappers.length - 1, idx + 1));
  };

private onResetFit = (): void => {
    this.computeFitWidthScale();
    this.setScale(this.fitWidthScale);
    this.viewport.scrollTop = 0;
  };

  private onViewportScroll = (): void => this.updateNavUi();

private onWheel = (e: WheelEvent): void => {
    const wantsZoom = e.ctrlKey || e.metaKey;
    if (!wantsZoom) return;
    
    const rect = this.viewport.getBoundingClientRect();
    const isOverViewport = 
      e.clientX >= rect.left && 
      e.clientX <= rect.right &&
      e.clientY >= rect.top && 
      e.clientY <= rect.bottom;
    
    if (!isOverViewport) return;

    e.preventDefault();
    e.stopPropagation();

    const direction = e.deltaY > 0 ? -1 : 1;
    this.setScale(this.currentScale + direction * this.zoomStep);
  };


  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;

    e.preventDefault();
    this.isPanning = true;
    this.panStartX = e.clientX;
    this.panStartY = e.clientY;
    this.panStartScrollLeft = this.viewport.scrollLeft;
    this.panStartScrollTop = this.viewport.scrollTop;

    this.viewport.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isPanning) return;

    const dx = e.clientX - this.panStartX;
    const dy = e.clientY - this.panStartY;

    this.viewport.scrollLeft = this.panStartScrollLeft - dx;
    this.viewport.scrollTop = this.panStartScrollTop - dy;
  };

  private onMouseUp = (): void => {
    if (!this.isPanning) return;
    this.isPanning = false;
    this.viewport.style.cursor = "default";
    document.body.style.userSelect = "";
  };

  private applyToolbarVisibility(): void {
    this.toolbar.style.display = this.showToolbar ? "flex" : "none";
  }

  private updateZoomUi(): void {
    this.zoomLabel.innerText = `${Math.round(this.currentScale * 100)}%`;
  }

  private updateNavUi(): void {
    const total = this.pageWrappers.length;
    if (!total) {
      this.pageLabel.innerText = "0 / 0";
      this.btnPrev.disabled = true;
      this.btnNext.disabled = true;
      return;
    }

    const idx = this.getCurrentPageIndex();
    this.pageLabel.innerText = `${idx + 1} / ${total}`;

    this.btnPrev.disabled = idx <= 0;
    this.btnNext.disabled = idx >= total - 1;
  }

  private getCurrentPageIndex(): number {
    if (!this.pageWrappers.length) return 0;

    const top = this.viewport.scrollTop;
    const viewMid = top + this.viewport.clientHeight * 0.35;

    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.pageWrappers.length; i++) {
      const el = this.pageWrappers[i];
      const y = el.offsetTop;
      const dist = Math.abs(y - viewMid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }

    return best;
  }

  private scrollToPage(index: number): void {
    const el = this.pageWrappers[index];
    if (!el) return;
    this.viewport.scrollTop = Math.max(0, el.offsetTop - 8);
  }

  private setLoading(loading: boolean): void {
    this.overlay.style.display = loading ? "flex" : "none";
  }

  private setError(msg: string): void {
    this.errorBox.innerText = msg;
    this.errorBox.style.display = "block";
  }

  private clearError(): void {
    this.errorBox.innerText = "";
    this.errorBox.style.display = "none";
  }

  private createIconButton(title: string, pathD: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);

    btn.style.width = "28px";
    btn.style.height = "28px";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.style.border = "1px solid transparent";
    btn.style.borderRadius = "6px";
    btn.style.background = "transparent";
    btn.style.cursor = "pointer";
    btn.style.padding = "0";

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#f4f4f4";
      btn.style.borderColor = "#e5e5e5";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.borderColor = "transparent";
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#555");
    path.setAttribute("stroke-width", "2.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
    btn.appendChild(svg);

    return btn;
  }

  private createTextButton(text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = text;

    btn.style.height = "28px";
    btn.style.padding = "0 14px";
    btn.style.borderRadius = "8px";
    btn.style.border = "1px solid #d0d0d0";
    btn.style.background = "#fff";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "12px";
    btn.style.color = "#333";
    btn.style.fontWeight = "500";

    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#f4f4f4";
      btn.style.borderColor = "#c0c0c0";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#fff";
      btn.style.borderColor = "#d0d0d0";
    });

    return btn;
  }

  private clampNumber(v: number, min: number, max: number): number {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  private dataUriToBytes(input: string): Uint8Array {
    let s = (input || "").trim();

    const comma = s.indexOf(",");
    if (s.startsWith("data:") && comma >= 0) {
      s = s.substring(comma + 1);
    }

    const base64 = s.replace(/[\r\n\s]/g, "");
    const binary = window.atob(base64);

    const bytes = new Uint8Array(binary.length);
    let i = 0;
    for (const ch of binary) {
      bytes[i++] = ch.charCodeAt(0);
    }
    return bytes;
  }
}