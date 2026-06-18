import { Point, SketchDoc, Stroke, ToolName } from "./model";
import { renderDocToContext, strokeToOutline, fillOutline } from "./export";

export interface BrushSettings {
	tool: ToolName;
	color: string;
	size: number;
	opacity: number;
}

export interface SketchCanvasOptions {
	palmRejection: boolean;
	onChange: () => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Keep at least this many CSS px of the page on-screen when panning. */
const PAN_MARGIN = 48;
/** Bounds for a sketch's logical canvas dimensions. */
export const MIN_CANVAS_SIZE = 64;
export const MAX_CANVAS_SIZE = 8192;

interface ViewState {
	scale: number;
	tx: number;
	ty: number;
}

/** Where existing content is anchored when the canvas is resized. */
export type CanvasAnchor =
	| "top-left"
	| "top"
	| "top-right"
	| "left"
	| "center"
	| "right"
	| "bottom-left"
	| "bottom"
	| "bottom-right";

const ANCHOR_FACTORS: Record<CanvasAnchor, { x: number; y: number }> = {
	"top-left": { x: 0, y: 0 },
	top: { x: 0.5, y: 0 },
	"top-right": { x: 1, y: 0 },
	left: { x: 0, y: 0.5 },
	center: { x: 0.5, y: 0.5 },
	right: { x: 1, y: 0.5 },
	"bottom-left": { x: 0, y: 1 },
	bottom: { x: 0.5, y: 1 },
	"bottom-right": { x: 1, y: 1 },
};

/** Undo/redo captures the document state we let users change: size + strokes. */
interface DocSnapshot {
	width: number;
	height: number;
	strokes: Stroke[];
}

/**
 * Interactive drawing surface. Owns a <canvas>, handles Pointer Events with
 * pressure + coalesced events for an iOS-Notes-like feel, supports two-finger
 * pan/zoom (and wheel zoom on desktop), and maintains an undo/redo stack over
 * the SketchDoc's strokes.
 */
export class SketchCanvas {
	readonly el: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private doc: SketchDoc;
	private brush: BrushSettings;
	private readonly options: SketchCanvasOptions;

	private dpr = 1;
	/** Document -> CSS-pixel viewport transform. */
	private view: ViewState = { scale: 1, tx: 0, ty: 0 };
	private viewInitialized = false;

	private activeStroke: Stroke | null = null;
	private activePointerId: number | null = null;
	/** True while a stylus pointer is down (used for palm rejection). */
	private penActive = false;

	/** All currently-down pointers (client coords), for pinch detection. */
	private pointers = new Map<number, { x: number; y: number }>();
	private inGesture = false;
	private gestureStart: {
		dist: number;
		midDocX: number;
		midDocY: number;
	} | null = null;

	private undoStack: DocSnapshot[] = [];
	private redoStack: DocSnapshot[] = [];

	// Cached theme colors for the page chrome (refreshed on resize).
	private pageColor = "#ffffff";
	private workColor = "#000000";
	private borderColor = "rgba(0,0,0,0.2)";

	constructor(
		parent: HTMLElement,
		doc: SketchDoc,
		brush: BrushSettings,
		options: SketchCanvasOptions,
	) {
		this.doc = doc;
		this.brush = brush;
		this.options = options;

		this.el = parent.createEl("canvas", { cls: "tabula-rasa-canvas" });
		const ctx = this.el.getContext("2d");
		if (!ctx) throw new Error("Could not acquire 2D drawing context");
		this.ctx = ctx;

		this.registerPointerHandlers();
	}

	setBrush(brush: BrushSettings): void {
		this.brush = brush;
	}

	getDoc(): SketchDoc {
		return this.doc;
	}

	/** Resize the backing canvas to fill its container (at device pixel ratio). */
	resize(): void {
		const parent = this.el.parentElement;
		if (!parent) return;
		const rect = parent.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		this.dpr = window.devicePixelRatio || 1;
		this.el.style.width = `${rect.width}px`;
		this.el.style.height = `${rect.height}px`;
		this.el.width = Math.round(rect.width * this.dpr);
		this.el.height = Math.round(rect.height * this.dpr);

		this.refreshThemeColors();

		if (!this.viewInitialized) {
			this.fitView();
			this.viewInitialized = true;
		} else {
			this.clampView();
		}
		this.redraw();
	}

	/** Center and scale the document to comfortably fit the viewport. */
	fitView(): void {
		const rect = this.el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const pad = 24;
		const sx = (rect.width - pad * 2) / this.doc.width;
		const sy = (rect.height - pad * 2) / this.doc.height;
		const scale = this.clampScale(Math.min(sx, sy));
		this.view = {
			scale,
			tx: (rect.width - this.doc.width * scale) / 2,
			ty: (rect.height - this.doc.height * scale) / 2,
		};
		this.redraw();
	}

	/** Full re-render of the page chrome, document, and any in-progress stroke. */
	redraw(): void {
		const { ctx } = this;
		if (this.el.width === 0 || this.el.height === 0) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.el.width, this.el.height);
		// Map device pixels -> CSS pixels -> document units.
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		ctx.translate(this.view.tx, this.view.ty);
		ctx.scale(this.view.scale, this.view.scale);

		this.drawPage();
		renderDocToContext(ctx, this.doc);
		if (this.activeStroke) this.drawStroke(this.activeStroke);
	}

	/** Draw the page rectangle so the drawable bounds are clear when panned/zoomed. */
	private drawPage(): void {
		const { ctx, doc } = this;
		// A transparent document shows the app background through the embed, so
		// preview it on the same color; otherwise show the document's own color.
		ctx.fillStyle =
			doc.background && doc.background !== "transparent"
				? doc.background
				: this.pageColor;
		ctx.fillRect(0, 0, doc.width, doc.height);
		ctx.lineWidth = 1 / this.view.scale;
		ctx.strokeStyle = this.borderColor;
		ctx.strokeRect(0, 0, doc.width, doc.height);
	}

	clear(): void {
		this.pushUndo();
		this.doc.strokes = [];
		this.redraw();
		this.options.onChange();
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(): void {
		const prev = this.undoStack.pop();
		if (!prev) return;
		this.redoStack.push(this.snapshot());
		this.applySnapshot(prev);
		this.options.onChange();
	}

	redo(): void {
		const next = this.redoStack.pop();
		if (!next) return;
		this.undoStack.push(this.snapshot());
		this.applySnapshot(next);
		this.options.onChange();
	}

	private snapshot(): DocSnapshot {
		return {
			width: this.doc.width,
			height: this.doc.height,
			strokes: this.doc.strokes.slice(),
		};
	}

	/** Restore a snapshot, refitting the view only when the canvas size changed. */
	private applySnapshot(s: DocSnapshot): void {
		const sizeChanged =
			s.width !== this.doc.width || s.height !== this.doc.height;
		this.doc.width = s.width;
		this.doc.height = s.height;
		this.doc.strokes = s.strokes;
		if (sizeChanged) this.fitView();
		else this.redraw();
	}

	destroy(): void {
		this.el.remove();
	}

	// --- input handling -------------------------------------------------

	private registerPointerHandlers(): void {
		this.el.addEventListener("pointerdown", this.onPointerDown);
		this.el.addEventListener("pointermove", this.onPointerMove);
		this.el.addEventListener("pointerup", this.onPointerUp);
		this.el.addEventListener("pointercancel", this.onPointerUp);
		this.el.addEventListener("pointerleave", this.onPointerUp);
		this.el.addEventListener("wheel", this.onWheel, { passive: false });
	}

	private shouldIgnore(evt: PointerEvent): boolean {
		// Palm rejection: once a stylus is in use, ignore finger/touch input.
		if (
			this.options.palmRejection &&
			this.penActive &&
			evt.pointerType === "touch"
		) {
			return true;
		}
		return false;
	}

	private onPointerDown = (evt: PointerEvent): void => {
		if (evt.button !== undefined && evt.button > 0) return; // ignore right/middle
		if (this.shouldIgnore(evt)) return;

		this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

		// A second pointer turns the interaction into a pan/zoom gesture.
		if (this.pointers.size >= 2) {
			this.enterGesture();
			evt.preventDefault();
			return;
		}

		if (evt.pointerType === "pen") this.penActive = true;
		this.activePointerId = evt.pointerId;
		this.el.setPointerCapture(evt.pointerId);

		this.pushUndo();
		this.redoStack = [];

		const simulate = evt.pointerType !== "pen" || !(evt.pressure > 0);
		this.activeStroke = {
			tool: this.brush.tool,
			color: this.brush.color,
			size: this.brush.size,
			opacity: this.brush.opacity,
			simulatePressure: simulate,
			points: [this.toPoint(evt)],
		};
		evt.preventDefault();
	};

	private onPointerMove = (evt: PointerEvent): void => {
		if (this.pointers.has(evt.pointerId)) {
			this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
		}

		if (this.inGesture) {
			this.handleGestureMove();
			evt.preventDefault();
			return;
		}

		if (this.activePointerId !== evt.pointerId || !this.activeStroke) return;
		const events =
			typeof evt.getCoalescedEvents === "function"
				? evt.getCoalescedEvents()
				: [evt];
		for (const e of events.length ? events : [evt]) {
			this.activeStroke.points.push(this.toPoint(e));
		}
		this.redraw();
		evt.preventDefault();
	};

	private onPointerUp = (evt: PointerEvent): void => {
		this.pointers.delete(evt.pointerId);
		if (this.el.hasPointerCapture(evt.pointerId)) {
			this.el.releasePointerCapture(evt.pointerId);
		}

		if (this.inGesture) {
			if (this.pointers.size < 2) {
				this.inGesture = false;
				this.gestureStart = null;
			}
			return;
		}

		if (this.activePointerId !== evt.pointerId) return;
		if (evt.pointerType === "pen") this.penActive = false;
		this.activePointerId = null;

		const stroke = this.activeStroke;
		this.activeStroke = null;
		if (!stroke) return;

		if (stroke.tool === "eraser") {
			this.applyEraser(stroke);
		} else {
			this.doc.strokes.push(stroke);
		}
		this.redraw();
		this.options.onChange();
	};

	private onWheel = (evt: WheelEvent): void => {
		evt.preventDefault();
		const factor = evt.deltaY < 0 ? 1.1 : 1 / 1.1;
		this.zoomAt(factor, evt.clientX, evt.clientY);
	};

	// --- pan / zoom -----------------------------------------------------

	/** Abandon any in-progress stroke and begin a two-finger pan/zoom gesture. */
	private enterGesture(): void {
		if (this.activeStroke) {
			// Discard the dot started by the first finger and its undo entry.
			this.undoStack.pop();
			this.activeStroke = null;
		}
		if (this.activePointerId !== null) {
			if (this.el.hasPointerCapture(this.activePointerId)) {
				this.el.releasePointerCapture(this.activePointerId);
			}
			this.activePointerId = null;
		}
		this.penActive = false;
		this.inGesture = true;
		this.beginGestureFromPointers();
		this.redraw();
	}

	private beginGestureFromPointers(): void {
		const pts = Array.from(this.pointers.values()).slice(0, 2);
		if (pts.length < 2) return;
		const rect = this.el.getBoundingClientRect();
		const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
		const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
		this.gestureStart = {
			dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
			midDocX: (midX - this.view.tx) / this.view.scale,
			midDocY: (midY - this.view.ty) / this.view.scale,
		};
	}

	private handleGestureMove(): void {
		const pts = Array.from(this.pointers.values()).slice(0, 2);
		if (pts.length < 2 || !this.gestureStart) return;
		const rect = this.el.getBoundingClientRect();
		const newDist =
			Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
		const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
		const midY = (pts[0].y + pts[1].y) / 2 - rect.top;

		this.view.scale = this.clampScale(
			(this.gestureStart.dist > 0
				? newDist / this.gestureStart.dist
				: 1) * this.view.scale,
		);
		// Keep the document point that was under the gesture midpoint anchored.
		this.view.tx = midX - this.gestureStart.midDocX * this.view.scale;
		this.view.ty = midY - this.gestureStart.midDocY * this.view.scale;
		// Re-anchor for incremental moves.
		this.gestureStart.dist = newDist;
		this.gestureStart.midDocX = (midX - this.view.tx) / this.view.scale;
		this.gestureStart.midDocY = (midY - this.view.ty) / this.view.scale;

		this.clampView();
		this.redraw();
	}

	private zoomAt(factor: number, clientX: number, clientY: number): void {
		const rect = this.el.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const docX = (px - this.view.tx) / this.view.scale;
		const docY = (py - this.view.ty) / this.view.scale;
		this.view.scale = this.clampScale(this.view.scale * factor);
		this.view.tx = px - docX * this.view.scale;
		this.view.ty = py - docY * this.view.scale;
		this.clampView();
		this.redraw();
	}

	private clampScale(scale: number): number {
		return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
	}

	/** Keep part of the page on-screen so it can't be panned entirely away. */
	private clampView(): void {
		const rect = this.el.getBoundingClientRect();
		if (rect.width === 0) return;
		const w = this.doc.width * this.view.scale;
		const h = this.doc.height * this.view.scale;
		this.view.tx = Math.min(
			rect.width - PAN_MARGIN,
			Math.max(PAN_MARGIN - w, this.view.tx),
		);
		this.view.ty = Math.min(
			rect.height - PAN_MARGIN,
			Math.max(PAN_MARGIN - h, this.view.ty),
		);
	}

	private refreshThemeColors(): void {
		const cs = getComputedStyle(this.el);
		const read = (name: string, fallback: string) =>
			cs.getPropertyValue(name).trim() || fallback;
		this.pageColor = read("--background-primary", this.pageColor);
		this.workColor = read("--background-primary-alt", this.workColor);
		this.borderColor = read("--background-modifier-border", this.borderColor);
		this.el.style.backgroundColor = this.workColor;
	}

	/** Convert a pointer event to a logical document-space point with pressure. */
	private toPoint(evt: PointerEvent): Point {
		const rect = this.el.getBoundingClientRect();
		const x = (evt.clientX - rect.left - this.view.tx) / this.view.scale;
		const y = (evt.clientY - rect.top - this.view.ty) / this.view.scale;
		// Mouse/touch often report pressure 0; fall back to a neutral 0.5.
		let p = evt.pressure;
		if (!p || p <= 0) p = 0.5;
		return { x, y, p };
	}

	private drawStroke(stroke: Stroke): void {
		if (stroke.tool === "eraser") return;
		const outline = strokeToOutline(stroke);
		this.ctx.globalAlpha = stroke.opacity;
		this.ctx.fillStyle = stroke.color;
		fillOutline(this.ctx, outline);
		this.ctx.globalAlpha = 1;
	}

	/** Remove any stroke whose points fall within the eraser path radius. */
	private applyEraser(eraser: Stroke): void {
		const radius = eraser.size;
		const kept = this.doc.strokes.filter((stroke) => {
			if (stroke.tool === "eraser") return false;
			return !this.strokeIntersectsEraser(stroke, eraser, radius);
		});
		this.doc.strokes = kept;
	}

	private strokeIntersectsEraser(
		stroke: Stroke,
		eraser: Stroke,
		radius: number,
	): boolean {
		const threshold = radius + stroke.size / 2;
		const thresholdSq = threshold * threshold;
		for (const ep of eraser.points) {
			for (const sp of stroke.points) {
				const dx = ep.x - sp.x;
				const dy = ep.y - sp.y;
				if (dx * dx + dy * dy <= thresholdSq) return true;
			}
		}
		return false;
	}

	private pushUndo(): void {
		this.undoStack.push(this.snapshot());
		// Cap history to keep memory in check on mobile.
		if (this.undoStack.length > 50) this.undoStack.shift();
	}

	// --- canvas sizing --------------------------------------------------

	private clampDimension(n: number): number {
		if (!Number.isFinite(n)) return MIN_CANVAS_SIZE;
		return Math.round(
			Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, n)),
		);
	}

	/**
	 * Resize the logical canvas. Existing strokes are either repositioned via
	 * `anchor` (keeping their real size) or, when `scaleToFit` is set, uniformly
	 * scaled so the drawing fills the new canvas. Undoable.
	 */
	resizeCanvas(
		width: number,
		height: number,
		anchor: CanvasAnchor = "center",
		scaleToFit = false,
	): void {
		const newW = this.clampDimension(width);
		const newH = this.clampDimension(height);
		const oldW = this.doc.width;
		const oldH = this.doc.height;
		if (newW === oldW && newH === oldH) return;

		this.pushUndo();
		this.redoStack = [];

		const factor = scaleToFit ? Math.min(newW / oldW, newH / oldH) : 1;
		const a = ANCHOR_FACTORS[anchor];
		const offsetX = (newW - oldW * factor) * a.x;
		const offsetY = (newH - oldH * factor) * a.y;
		this.transformStrokes(factor, offsetX, offsetY);

		this.doc.width = newW;
		this.doc.height = newH;
		this.fitView();
		this.options.onChange();
	}

	/**
	 * Shrink (or grow) the canvas to tightly wrap the existing drawing, leaving a
	 * uniform `padding` margin. No-op when there are no strokes. Undoable.
	 */
	fitCanvasToContent(padding = 48): void {
		const bounds = this.contentBounds();
		if (!bounds) return;

		this.pushUndo();
		this.redoStack = [];

		const newW = this.clampDimension(bounds.maxX - bounds.minX + padding * 2);
		const newH = this.clampDimension(bounds.maxY - bounds.minY + padding * 2);
		this.transformStrokes(1, padding - bounds.minX, padding - bounds.minY);

		this.doc.width = newW;
		this.doc.height = newH;
		this.fitView();
		this.options.onChange();
	}

	/**
	 * Replace strokes with copies whose points are scaled by `factor` and shifted
	 * by (dx, dy). We build new objects so snapshots already on the undo stack
	 * (which share the previous stroke instances) stay intact.
	 */
	private transformStrokes(factor: number, dx: number, dy: number): void {
		if (factor === 1 && dx === 0 && dy === 0) return;
		this.doc.strokes = this.doc.strokes.map((stroke) => ({
			...stroke,
			size: stroke.size * factor,
			points: stroke.points.map((p) => ({
				x: p.x * factor + dx,
				y: p.y * factor + dy,
				p: p.p,
			})),
		}));
	}

	/** Bounding box of all stroke points (inflated by each stroke's half-width). */
	private contentBounds(): {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	} | null {
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const stroke of this.doc.strokes) {
			const r = stroke.size / 2;
			for (const pt of stroke.points) {
				minX = Math.min(minX, pt.x - r);
				minY = Math.min(minY, pt.y - r);
				maxX = Math.max(maxX, pt.x + r);
				maxY = Math.max(maxY, pt.y + r);
			}
		}
		if (!Number.isFinite(minX)) return null;
		return { minX, minY, maxX, maxY };
	}
}
