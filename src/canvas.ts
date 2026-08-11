import { Point, SketchDoc, Stroke, ToolName } from "./model";
import { renderDocToContext, strokeToOutline, fillOutline } from "./export";
import {
	DEFAULT_GESTURE_SETTINGS,
	DoubleTapRecognizer,
	GestureSettings,
	TouchSequenceTracker,
} from "./gestures";
import {
	Bounds,
	HandleId,
	MIN_LASSO_SPAN,
	Matrix,
	ScaleHandle,
	SelectionMode,
	Vec,
	boundsContain,
	boundsSpan,
	flipAbout,
	insetBounds,
	handlePositions,
	isIdentity,
	mergeSelection,
	polygonBounds,
	rotateAbout,
	scaleFromHandle,
	strokesInPolygon,
	transformStroke,
	translation,
	unionBounds,
} from "./selection";
import { meanPressure, recogniseShape, shapePoints } from "./shapes";

export type EraserMode = "stroke" | "partial";

export interface BrushSettings {
	tool: ToolName;
	color: string;
	size: number;
	opacity: number;
	/** How the eraser removes ink: whole strokes, or just the touched part. */
	eraserMode?: EraserMode;
}

export interface SketchCanvasOptions {
	palmRejection: boolean;
	onChange: () => void;
	gestures?: GestureSettings;
	/** Hold-to-snap: recognise a rough line or circle when the stroke pauses. */
	shapeSnap?: boolean;
	/** Fires when the selection appears, changes or goes away. */
	onSelectionChange?: () => void;
	/**
	 * A press held still with the selection tool active. `inSelection` says whether
	 * it landed on the current selection, which is what decides whether there's
	 * anything to copy or delete.
	 */
	onLongPress?: (info: {
		clientX: number;
		clientY: number;
		inSelection: boolean;
	}) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** Keep at least this many CSS px of the page on-screen when panning. */
const PAN_MARGIN = 48;
/** Bounds for a sketch's logical canvas dimensions. */
export const MIN_CANVAS_SIZE = 64;
/** Corner radius of the drawable page, in document pixels. */
const PAGE_CORNER_RADIUS = 4;
export const MAX_CANVAS_SIZE = 8192;

/** Drawn radius of a selection handle, in CSS px — constant at any zoom. */
const HANDLE_RADIUS = 5.5;
/** Hit radius for grabbing one. Fingers are bigger than the dot they aim at. */
const HANDLE_TOUCH_RADIUS = 24;
/** How far above the box the rotate handle floats, in CSS px. */
const ROTATE_HANDLE_OFFSET = 34;
/** A selection can't be squeezed below this, in document units. */
const MIN_SELECTION_SIZE = 8;
/** Where a pasted copy lands relative to the original, in document units. */
const PASTE_OFFSET = 16;
/**
 * How long you hold still at the end of a stroke before a rough line or circle
 * becomes a clean one. Long enough that a pause for thought mid-stroke doesn't
 * trigger it, short enough that you don't wonder whether it's working.
 */
const SNAP_HOLD_MS = 600;
/** Movement under this doesn't restart the hold — a resting thumb still drifts. */
const SNAP_HOLD_DRIFT = 4;

/** How long a press must be held to count as a long press. */
const LONG_PRESS_MS = 480;
/** How far it may drift first, in CSS px — a held thumb is never perfectly still. */
const LONG_PRESS_MAX_TRAVEL = 12;

interface ViewState {
	scale: number;
	tx: number;
	ty: number;
	/** Canvas rotation in radians (two-finger twist). */
	rotation: number;
}

/** Wrap an angle to (-π, π]. */
function normalizeAngle(a: number): number {
	return Math.atan2(Math.sin(a), Math.cos(a));
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

/** The handle a pointer landed on, or null for "none of them". */
type HandleHit = HandleId | null;

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
	/** The tool as of the last setBrush, so a tool change is detectable. */
	private lastTool: ToolName;
	private readonly options: SketchCanvasOptions;

	private dpr = 1;
	/** Document -> CSS-pixel viewport transform. */
	private view: ViewState = { scale: 1, tx: 0, ty: 0, rotation: 0 };
	private viewInitialized = false;

	private activeStroke: Stroke | null = null;
	private activePointerId: number | null = null;
	/**
	 * Pending hold-to-snap. Armed on every move and left alone while the finger
	 * only drifts, because a still finger sends no move events at all — the timer
	 * is the only thing that knows you've stopped.
	 */
	private snapHold: { timer: number; x: number; y: number } | null = null;
	/** True once this stroke has been snapped, so it stops taking new points. */
	private snapped = false;
	/** True while a stylus pointer is down (used for palm rejection). */
	private penActive = false;

	/** All currently-down pointers (client coords), for pinch detection. */
	private pointers = new Map<number, { x: number; y: number }>();
	private inGesture = false;
	private gestureStart: {
		startDist: number;
		startScale: number;
		prevAngle: number;
		/** Document point under the pinch midpoint when the gesture began. */
		anchorDocX: number;
		anchorDocY: number;
	} | null = null;

	/**
	 * Live copy of the palm-rejection preference. Held here rather than read from
	 * options so the settings sheet can toggle it mid-sketch without rebuilding the
	 * canvas and losing the current zoom, pan and rotation.
	 */
	private palmRejection: boolean;

	/** Tracks the current touch (all fingers down → all fingers up). */
	private tracker: TouchSequenceTracker | null = null;
	/** Remembers the previous tap so a second one can complete a double tap. */
	private doubleTap = new DoubleTapRecognizer();

	private undoStack: DocSnapshot[] = [];
	private redoStack: DocSnapshot[] = [];

	// --- selection state ---
	/** The boundary being drawn, in document units. Null when not lassoing. */
	private lasso: Vec[] | null = null;
	/**
	 * Indices into doc.strokes. Indices (rather than references) because every
	 * operation available while a selection is live — transform, paste — keeps
	 * existing positions; anything that reshuffles the array drops the selection.
	 */
	private selected = new Set<number>();
	private selectionMode: SelectionMode = "replace";
	/** What the current pointer is doing, when the selection tool has it. */
	private selectionInput: "lasso" | "transform" | null = null;
	/** Pending long press: the timer, and where the finger went down. */
	private longPress: {
		timer: number;
		clientX: number;
		clientY: number;
		inSelection: boolean;
	} | null = null;
	/**
	 * A transform in progress. The originals are kept so each move recomputes from
	 * them rather than compounding — otherwise rounding accumulates and a drag
	 * back to where it started doesn't return the strokes there.
	 */
	private transformDrag: {
		kind: "move" | "scale" | "rotate";
		handle?: ScaleHandle;
		/** Where the grabbed handle sat when the drag began, in document units. */
		handleOrigin?: Vec;
		originBounds: Bounds;
		originStrokes: Map<number, Stroke>;
		startDoc: Vec;
		startAngle: number;
	} | null = null;

	// Cached theme colors for the page chrome (refreshed on resize).
	private pageColor = "#ffffff";
	private workColor = "#000000";
	private borderColor = "rgba(0,0,0,0.2)";
	private accentColor = "#4c8dff";

	constructor(
		parent: HTMLElement,
		doc: SketchDoc,
		brush: BrushSettings,
		options: SketchCanvasOptions,
	) {
		this.doc = doc;
		this.brush = brush;
		this.lastTool = brush.tool;
		this.options = options;
		this.palmRejection = options.palmRejection;

		this.el = parent.createEl("canvas", { cls: "tabula-rasa-canvas" });
		const ctx = this.el.getContext("2d");
		if (!ctx) throw new Error("Could not acquire 2D drawing context");
		this.ctx = ctx;

		this.registerPointerHandlers();
	}

	/**
	 * Leaving the selection tool drops the selection. That keeps stroke indices
	 * trustworthy — the eraser and partial-erase rebuild the stroke array — and it
	 * matches what the bottom bar implies, since the bar is the selection's UI.
	 */
	setBrush(brush: BrushSettings): void {
		// Compared against our own copy of the last tool, not against this.brush:
		// the view hands us the same object it mutates, so by the time we're called
		// this.brush.tool is already the new tool and the check never fired.
		const leavingSelect = this.lastTool === "select" && brush.tool !== "select";
		this.lastTool = brush.tool;
		this.brush = brush;
		if (leavingSelect) this.clearSelection();
	}

	setPalmRejection(enabled: boolean): void {
		this.palmRejection = enabled;
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
		// Fit also returns the page to upright.
		this.view = {
			scale,
			tx: (rect.width - this.doc.width * scale) / 2,
			ty: (rect.height - this.doc.height * scale) / 2,
			rotation: 0,
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
		ctx.rotate(this.view.rotation);
		ctx.scale(this.view.scale, this.view.scale);

		this.drawPage();
		renderDocToContext(ctx, this.doc);
		if (this.activeStroke) this.drawStroke(this.activeStroke);
		this.drawSelectionOverlay();
	}

	/**
	 * Draw the page. The work area behind it is the same colour, so the page reads
	 * as part of the background rather than a slab floating on it; the only thing
	 * marking the drawable bounds is a hairline edge and a slight corner radius.
	 */
	private drawPage(): void {
		const { ctx, doc } = this;
		const radius = PAGE_CORNER_RADIUS;
		// A transparent document shows the app background through the embed, so
		// preview it on the same color; otherwise show the document's own color.
		ctx.fillStyle =
			doc.background && doc.background !== "transparent"
				? doc.background
				: this.pageColor;
		this.pagePath(radius);
		ctx.fill();
		// Hairline, so it delineates the edge without becoming a frame.
		ctx.lineWidth = 1 / this.view.scale;
		ctx.strokeStyle = this.borderColor;
		this.pagePath(radius);
		ctx.stroke();
	}

	private pagePath(radius: number): void {
		const { ctx, doc } = this;
		const r = Math.max(0, Math.min(radius, doc.width / 2, doc.height / 2));
		ctx.beginPath();
		if (typeof ctx.roundRect === "function") {
			ctx.roundRect(0, 0, doc.width, doc.height, r);
			return;
		}
		// Fallback for webviews without roundRect.
		ctx.moveTo(r, 0);
		ctx.arcTo(doc.width, 0, doc.width, doc.height, r);
		ctx.arcTo(doc.width, doc.height, 0, doc.height, r);
		ctx.arcTo(0, doc.height, 0, 0, r);
		ctx.arcTo(0, 0, doc.width, 0, r);
		ctx.closePath();
	}

	clear(): void {
		this.pushUndo();
		this.doc.strokes = [];
		this.clearSelection();
		this.redraw();
		this.options.onChange();
	}

	/**
	 * Change this sketch's background. Undoable, since it's as destructive to a
	 * drawing's legibility as erasing — white ink on a white page vanishes.
	 */
	setBackground(background: string): void {
		if (this.doc.background === background) return;
		this.pushUndo();
		this.doc.background = background;
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
		// A restored snapshot is a different stroke array, so index-based selection
		// no longer means anything — undoing past a selection drops it.
		this.clearSelection();
		if (sizeChanged) this.fitView();
		else this.redraw();
	}

	destroy(): void {
		this.cancelSnapHold();
		this.cancelLongPress();
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
			this.palmRejection &&
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

		// Track every touch from the first finger down, so that when the last one
		// lifts we can tell a tap from a drag and count how many fingers took part.
		if (this.pointers.size === 1) {
			this.tracker = new TouchSequenceTracker(this.pointerList());
		} else {
			// Re-baseline rather than update: a new finger shifts the centroid, and
			// that shift is not the user moving their hand.
			this.tracker?.rebase(this.pointerList());
		}

		// A second pointer turns the interaction into a pan/zoom gesture.
		if (this.pointers.size >= 2) {
			this.enterGesture();
			evt.preventDefault();
			return;
		}

		// The selection tool lays down no ink: the same drag either grabs a handle,
		// slides the current selection, or draws a new boundary.
		if (this.brush.tool === "select") {
			this.activePointerId = evt.pointerId;
			this.el.setPointerCapture(evt.pointerId);
			this.armLongPress(evt);
			this.beginSelectionInput(evt);
			evt.preventDefault();
			return;
		}

		if (evt.pointerType === "pen") this.penActive = true;
		this.activePointerId = evt.pointerId;
		this.el.setPointerCapture(evt.pointerId);

		// Note: the redo stack is cleared when a stroke actually commits, not here.
		// Clearing it on finger-down destroyed redo history for any gesture that
		// starts with a touch — which is every one of them.
		this.pushUndo();

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

		this.tracker?.update(this.pointerList());

		if (this.inGesture) {
			this.handleGestureMove();
			evt.preventDefault();
			return;
		}

		if (this.selectionInput && this.activePointerId === evt.pointerId) {
			this.trackLongPress(evt);
			this.updateSelectionInput(evt);
			evt.preventDefault();
			return;
		}

		if (this.activePointerId !== evt.pointerId || !this.activeStroke) return;
		// A snapped stroke is finished: further movement would just re-roughen the
		// shape the snap was asked for. Lift and draw again to change it.
		if (this.snapped) {
			evt.preventDefault();
			return;
		}
		const events =
			typeof evt.getCoalescedEvents === "function"
				? evt.getCoalescedEvents()
				: [evt];
		for (const e of events.length ? events : [evt]) {
			this.activeStroke.points.push(this.toPoint(e));
		}
		this.armSnapHold(evt);
		this.redraw();
		evt.preventDefault();
	};

	private onPointerUp = (evt: PointerEvent): void => {
		this.pointers.delete(evt.pointerId);
		if (this.el.hasPointerCapture(evt.pointerId)) {
			this.el.releasePointerCapture(evt.pointerId);
		}

		// The touch only resolves once every finger is up, so a two- or
		// three-finger tap is counted by how many fingers took part in total.
		if (this.tracker && this.pointers.size === 0) {
			const seq = this.tracker.finish();
			this.tracker = null;
			const action = this.doubleTap.push(
				seq,
				this.options.gestures ?? DEFAULT_GESTURE_SETTINGS,
			);
			if (action === "undo") this.undo();
			else if (action === "redo") this.redo();
		}

		if (this.inGesture) {
			if (this.pointers.size < 2) {
				this.inGesture = false;
				this.gestureStart = null;
			} else {
				// Re-baseline so removing a finger doesn't jump the view.
				this.beginGestureFromPointers();
			}
			return;
		}

		if (this.activePointerId !== evt.pointerId) return;

		if (this.selectionInput) {
			this.cancelLongPress();
			this.activePointerId = null;
			this.finishSelectionInput();
			return;
		}

		if (evt.pointerType === "pen") this.penActive = false;
		this.activePointerId = null;

		this.cancelSnapHold();
		this.snapped = false;
		const stroke = this.activeStroke;
		this.activeStroke = null;
		if (!stroke) return;

		// A committed stroke is a new branch of history, so redo is no longer valid.
		this.redoStack = [];
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
		this.cancelSnapHold();
		this.snapped = false;
		if (this.activeStroke) {
			// Discard the dot started by the first finger and its undo entry.
			this.undoStack.pop();
			this.activeStroke = null;
		}
		// A second finger means pan/zoom, not selection: throw away whatever the
		// first finger had started so a pinch never half-applies a transform.
		this.abortSelectionInput();
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

	/** Current pointer positions in client coords, for gesture tracking. */
	private pointerList(): { x: number; y: number }[] {
		return Array.from(this.pointers.values());
	}

	private beginGestureFromPointers(): void {
		const pts = Array.from(this.pointers.values()).slice(0, 2);
		if (pts.length < 2) return;
		const rect = this.el.getBoundingClientRect();
		const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
		const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
		const anchor = this.screenToDoc(midX, midY);
		this.gestureStart = {
			startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
			startScale: this.view.scale,
			prevAngle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
			anchorDocX: anchor.x,
			anchorDocY: anchor.y,
		};
	}

	private handleGestureMove(): void {
		const pts = Array.from(this.pointers.values()).slice(0, 2);
		if (pts.length < 2 || !this.gestureStart) return;
		const g = this.gestureStart;
		const rect = this.el.getBoundingClientRect();
		const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
		const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
		const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
		const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);

		// Scale is absolute from gesture start; rotation accumulates per move
		// (unwrapped) so twisting past ±180° keeps working.
		this.view.scale = this.clampScale((dist / g.startDist) * g.startScale);
		this.view.rotation += normalizeAngle(angle - g.prevAngle);
		g.prevAngle = angle;

		// Keep the anchored document point pinned under the moving midpoint.
		const c = Math.cos(this.view.rotation);
		const s = Math.sin(this.view.rotation);
		const sc = this.view.scale;
		this.view.tx = midX - sc * (c * g.anchorDocX - s * g.anchorDocY);
		this.view.ty = midY - sc * (s * g.anchorDocX + c * g.anchorDocY);

		this.clampView();
		this.redraw();
	}

	private zoomAt(factor: number, clientX: number, clientY: number): void {
		const rect = this.el.getBoundingClientRect();
		const px = clientX - rect.left;
		const py = clientY - rect.top;
		const doc = this.screenToDoc(px, py);
		this.view.scale = this.clampScale(this.view.scale * factor);
		// Re-pin the document point that was under the cursor.
		const c = Math.cos(this.view.rotation);
		const s = Math.sin(this.view.rotation);
		const sc = this.view.scale;
		this.view.tx = px - sc * (c * doc.x - s * doc.y);
		this.view.ty = py - sc * (s * doc.x + c * doc.y);
		this.clampView();
		this.redraw();
	}

	private clampScale(scale: number): number {
		return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
	}

	/**
	 * Screen extents (relative to the canvas, before translation) of the page's
	 * four corners under the current scale + rotation. Used for pan clamping.
	 */
	private pageScreenExtents(): {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	} {
		const c = Math.cos(this.view.rotation);
		const s = Math.sin(this.view.rotation);
		const sc = this.view.scale;
		const corners: [number, number][] = [
			[0, 0],
			[this.doc.width, 0],
			[this.doc.width, this.doc.height],
			[0, this.doc.height],
		];
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (const [x, y] of corners) {
			const sx = sc * (c * x - s * y);
			const sy = sc * (s * x + c * y);
			minX = Math.min(minX, sx);
			maxX = Math.max(maxX, sx);
			minY = Math.min(minY, sy);
			maxY = Math.max(maxY, sy);
		}
		return { minX, maxX, minY, maxY };
	}

	/** Keep part of the page on-screen so it can't be panned entirely away. */
	private clampView(): void {
		const rect = this.el.getBoundingClientRect();
		if (rect.width === 0) return;
		const e = this.pageScreenExtents();
		this.view.tx = Math.min(
			rect.width - PAN_MARGIN - e.minX,
			Math.max(PAN_MARGIN - e.maxX, this.view.tx),
		);
		this.view.ty = Math.min(
			rect.height - PAN_MARGIN - e.minY,
			Math.max(PAN_MARGIN - e.maxY, this.view.ty),
		);
	}

	private refreshThemeColors(): void {
		const cs = getComputedStyle(this.el);
		const read = (name: string, fallback: string) =>
			cs.getPropertyValue(name).trim() || fallback;
		this.pageColor = read("--background-primary", this.pageColor);
		// The work area matches the page, so a dark theme reads as black-on-black
		// and nothing frames the drawing but its own hairline edge.
		this.workColor = this.pageColor;
		this.borderColor = read("--background-modifier-border", this.borderColor);
		// Selection chrome borrows the theme's accent so it never reads as ink.
		this.accentColor = read("--interactive-accent", this.accentColor);
		this.el.style.backgroundColor = this.workColor;
	}

	/** Invert the view transform: canvas-relative CSS px -> document units. */
	private screenToDoc(px: number, py: number): { x: number; y: number } {
		const ox = px - this.view.tx;
		const oy = py - this.view.ty;
		const c = Math.cos(this.view.rotation);
		const s = Math.sin(this.view.rotation);
		// Undo rotation (R(-θ)) then scale.
		return {
			x: (c * ox + s * oy) / this.view.scale,
			y: (-s * ox + c * oy) / this.view.scale,
		};
	}

	/** Convert a pointer event to a logical document-space point with pressure. */
	private toPoint(evt: PointerEvent): Point {
		const rect = this.el.getBoundingClientRect();
		const { x, y } = this.screenToDoc(
			evt.clientX - rect.left,
			evt.clientY - rect.top,
		);
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

	/** Erase whole strokes, or split strokes around the eraser path. */
	private applyEraser(eraser: Stroke): void {
		if (this.brush.eraserMode === "partial") {
			this.applyPartialEraser(eraser);
		} else {
			this.applyWholeStrokeEraser(eraser);
		}
	}

	/** Remove any stroke whose points fall within the eraser path radius. */
	private applyWholeStrokeEraser(eraser: Stroke): void {
		const radius = eraser.size;
		const kept = this.doc.strokes.filter((stroke) => {
			if (stroke.tool === "eraser") return false;
			return !this.strokeIntersectsEraser(stroke, eraser, radius);
		});
		this.doc.strokes = kept;
	}

	/**
	 * Erase only the portions of strokes under the eraser, splitting each crossed
	 * stroke into the surviving runs of points (rebuilt as new strokes so undo
	 * snapshots keep the originals). Runs shorter than 2 points are dropped.
	 */
	private applyPartialEraser(eraser: Stroke): void {
		const radius = eraser.size / 2;
		const result: Stroke[] = [];
		for (const stroke of this.doc.strokes) {
			if (stroke.tool === "eraser") continue;
			const threshold = radius + stroke.size / 2;
			const thresholdSq = threshold * threshold;
			const erased = stroke.points.map((sp) =>
				this.pointNearEraser(sp, eraser, thresholdSq),
			);
			if (!erased.some(Boolean)) {
				result.push(stroke); // untouched — keep as-is
				continue;
			}
			let run: Point[] = [];
			const flush = () => {
				if (run.length >= 2) result.push({ ...stroke, points: run });
				run = [];
			};
			for (let i = 0; i < stroke.points.length; i++) {
				if (erased[i]) flush();
				else run.push(stroke.points[i]);
			}
			flush();
		}
		this.doc.strokes = result;
	}

	private pointNearEraser(
		point: Point,
		eraser: Stroke,
		thresholdSq: number,
	): boolean {
		for (const ep of eraser.points) {
			const dx = ep.x - point.x;
			const dy = ep.y - point.y;
			if (dx * dx + dy * dy <= thresholdSq) return true;
		}
		return false;
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

	/**
	 * Tell the view the selection changed. Guarded: the canvas must keep working
	 * even if the code drawing the bar fails. That exact failure is what put a
	 * dashed box on screen with no controls beside it — the box had already been
	 * drawn when the callback threw.
	 */
	private notifySelection(): void {
		try {
			this.options.onSelectionChange?.();
		} catch (e) {
			console.error("Tabula Rasa: selection UI update failed", e);
		}
	}

	private pushUndo(): void {
		this.undoStack.push(this.snapshot());
		// Cap history to keep memory in check on mobile.
		if (this.undoStack.length > 50) this.undoStack.shift();
	}

	// --- selection ------------------------------------------------------

	hasSelection(): boolean {
		return this.selected.size > 0;
	}

	selectionCount(): number {
		return this.selected.size;
	}

	getSelectionMode(): SelectionMode {
		return this.selectionMode;
	}

	setSelectionMode(mode: SelectionMode): void {
		this.selectionMode = mode;
	}

	/** Deselect. The strokes stay exactly as they are — this only drops the box. */
	clearSelection(): void {
		if (this.selected.size === 0 && !this.lasso) return;
		this.selected = new Set();
		this.lasso = null;
		this.redraw();
		this.notifySelection();
	}

	selectionBounds(): Bounds | null {
		return unionBounds(this.selectedStrokes());
	}

	private selectedStrokes(): Stroke[] {
		const out: Stroke[] = [];
		for (const i of this.selected) {
			const stroke = this.doc.strokes[i];
			if (stroke) out.push(stroke);
		}
		return out;
	}

	/** Deep copies, so later edits to the document don't reach into the clipboard. */
	copySelection(): Stroke[] | null {
		const strokes = this.selectedStrokes();
		if (strokes.length === 0) return null;
		return strokes.map((s) => ({
			...s,
			points: s.points.map((p) => ({ ...p })),
		}));
	}

	/**
	 * Drop copies onto the page, offset so they don't hide behind the originals,
	 * and select them — the pasted copy is what you want to move next.
	 */
	pasteStrokes(strokes: Stroke[]): void {
		if (strokes.length === 0) return;
		this.pushUndo();
		this.redoStack = [];
		const shift = translation(PASTE_OFFSET, PASTE_OFFSET);
		const start = this.doc.strokes.length;
		const pasted = strokes.map((s) =>
			transformStroke(
				{ ...s, points: s.points.map((p) => ({ ...p })) },
				shift,
			),
		);
		this.doc.strokes = this.doc.strokes.concat(pasted);
		this.selected = new Set(pasted.map((_, i) => start + i));
		this.redraw();
		this.options.onChange();
		this.notifySelection();
	}

	/**
	 * Remove the selected strokes. Distinct from clearSelection, which only drops
	 * the box: this one takes the ink with it. Undoable, and the selection goes
	 * afterwards because the indices it held no longer point at anything.
	 */
	deleteSelection(): void {
		if (this.selected.size === 0) return;
		this.pushUndo();
		this.redoStack = [];
		const doomed = this.selected;
		this.doc.strokes = this.doc.strokes.filter((_, i) => !doomed.has(i));
		this.clearSelection();
		this.redraw();
		this.options.onChange();
	}

	flipSelection(axis: "horizontal" | "vertical"): void {
		const bounds = this.selectionBounds();
		if (!bounds) return;
		this.commitTransform(flipAbout(axis, bounds));
	}

	rotateSelection(degrees: number): void {
		const bounds = this.selectionBounds();
		if (!bounds || !Number.isFinite(degrees) || degrees % 360 === 0) return;
		const cx = (bounds.minX + bounds.maxX) / 2;
		const cy = (bounds.minY + bounds.maxY) / 2;
		this.commitTransform(rotateAbout((degrees * Math.PI) / 180, cx, cy));
	}

	private commitTransform(m: Matrix): void {
		if (this.selected.size === 0 || isIdentity(m)) return;
		this.pushUndo();
		this.redoStack = [];
		this.applyToSelection(m);
		this.redraw();
		this.options.onChange();
		// The box moved, so anything reading its bounds needs to hear about it.
		this.notifySelection();
	}

	/**
	 * Rebuild the selected strokes through `m`, keeping their positions in the
	 * array so the index-based selection stays valid. `from` supplies the originals
	 * during a live drag so repeated moves don't compound.
	 */
	private applyToSelection(m: Matrix, from?: Map<number, Stroke>): void {
		const next = this.doc.strokes.slice();
		// An identity transform puts the originals back by reference rather than
		// rebuilding equal-but-different objects, so a drag that ends where it began
		// is detectably a no-op and leaves no undo entry.
		const identity = isIdentity(m);
		for (const i of this.selected) {
			const base = from?.get(i) ?? next[i];
			if (!base) continue;
			next[i] = identity ? base : transformStroke(base, m);
		}
		this.doc.strokes = next;
	}

	// --- selection input ------------------------------------------------

	// --- hold to snap ---------------------------------------------------

	/**
	 * Keep a hold timer running while the stroke is in progress. Re-armed only when
	 * the finger actually moves: small drift leaves the existing timer alone, so a
	 * hand that can't hold perfectly still still gets a snap.
	 */
	private armSnapHold(evt: PointerEvent): void {
		if (!this.options.shapeSnap || this.snapped) return;
		// The eraser has no shape to snap, and the selection tool never gets here.
		if (this.brush.tool === "eraser") return;
		const existing = this.snapHold;
		if (existing) {
			const drift = Math.hypot(evt.clientX - existing.x, evt.clientY - existing.y);
			if (drift <= SNAP_HOLD_DRIFT) return; // still holding — let it run
			window.clearTimeout(existing.timer);
		}
		this.snapHold = {
			x: evt.clientX,
			y: evt.clientY,
			timer: window.setTimeout(() => {
				this.snapHold = null;
				this.snapActiveStroke();
			}, SNAP_HOLD_MS),
		};
	}

	private cancelSnapHold(): void {
		if (!this.snapHold) return;
		window.clearTimeout(this.snapHold.timer);
		this.snapHold = null;
	}

	/**
	 * Replace the stroke in progress with the shape it was trying to be. Nothing
	 * happens if it doesn't look like one — holding still over a scribble should
	 * leave the scribble alone rather than guess.
	 */
	private snapActiveStroke(): void {
		const stroke = this.activeStroke;
		if (!stroke) return;
		const shape = recogniseShape(stroke.points);
		if (!shape) return;
		stroke.points = shapePoints(shape, meanPressure(stroke.points));
		// Velocity taper is what makes a freehand line lively and a snapped one
		// lumpy, so a snapped shape gets an even width.
		stroke.simulatePressure = false;
		this.snapped = true;
		this.redraw();
	}

	/**
	 * Start the clock on a long press. It fires only if the finger stays put, so it
	 * can't collide with drawing a boundary or dragging the box — and whatever that
	 * press had begun is abandoned when it does, since the menu replaces it.
	 */
	private armLongPress(evt: PointerEvent): void {
		if (!this.options.onLongPress) return;
		this.cancelLongPress();
		const doc = this.eventDoc(evt);
		const bounds = this.selectionBounds();
		const inSelection = !!bounds && boundsContain(bounds, doc.x, doc.y);
		const clientX = evt.clientX;
		const clientY = evt.clientY;
		this.longPress = {
			clientX,
			clientY,
			inSelection,
			timer: window.setTimeout(() => {
				this.longPress = null;
				this.abortSelectionInput();
				this.redraw();
				try {
					this.options.onLongPress?.({ clientX, clientY, inSelection });
				} catch (e) {
					console.error("Tabula Rasa: long-press menu failed", e);
				}
			}, LONG_PRESS_MS),
		};
	}

	private cancelLongPress(): void {
		if (!this.longPress) return;
		window.clearTimeout(this.longPress.timer);
		this.longPress = null;
	}

	/** Drift past the tolerance means it's a drag, not a press. */
	private trackLongPress(evt: PointerEvent): void {
		const lp = this.longPress;
		if (!lp) return;
		const moved = Math.hypot(evt.clientX - lp.clientX, evt.clientY - lp.clientY);
		if (moved > LONG_PRESS_MAX_TRAVEL) this.cancelLongPress();
	}

	/** Decide what this drag is: grabbing a handle, moving the box, or lassoing. */
	private beginSelectionInput(evt: PointerEvent): void {
		const doc = this.eventDoc(evt);
		const bounds = this.selectionBounds();

		if (bounds) {
			// Drag-to-move only in Replace mode. Add and Remove exist to draw another
			// boundary, and those boundaries almost always start inside the box you
			// already have — treating that as a move made both modes unreachable for
			// anything except a stroke sitting off on its own.
			const canMove = this.selectionMode === "replace";

			// The middle of the box is checked *before* the handles. Handles get a
			// finger-sized grab radius, which on a small selection reaches the centre
			// from every side — so the box could be scaled but never moved. Reserving
			// an inner region for moving fixes that at every size without shrinking
			// the handles' targets.
			const inner = insetBounds(bounds, this.handleInset());
			if (canMove && boundsContain(inner, doc.x, doc.y)) {
				this.startTransformDrag("move", undefined, doc, bounds);
				return;
			}

			const handle = this.handleAt(evt, bounds);
			if (handle) {
				this.startTransformDrag(
					handle === "rotate" ? "rotate" : "scale",
					handle === "rotate" ? undefined : handle,
					doc,
					bounds,
				);
				return;
			}

			// Inside the box but between handles: still a move.
			if (canMove && boundsContain(bounds, doc.x, doc.y)) {
				this.startTransformDrag("move", undefined, doc, bounds);
				return;
			}
		}

		this.selectionInput = "lasso";
		this.lasso = [doc];
		this.redraw();
	}

	private startTransformDrag(
		kind: "move" | "scale" | "rotate",
		handle: ScaleHandle | undefined,
		startDoc: Vec,
		originBounds: Bounds,
	): void {
		const originStrokes = new Map<number, Stroke>();
		for (const i of this.selected) {
			const stroke = this.doc.strokes[i];
			if (stroke) originStrokes.set(i, stroke);
		}
		const cx = (originBounds.minX + originBounds.maxX) / 2;
		const cy = (originBounds.minY + originBounds.maxY) / 2;
		this.selectionInput = "transform";
		this.transformDrag = {
			kind,
			handle,
			handleOrigin: handle
				? handlePositions(originBounds, 0).find((h) => h.id === handle)?.at
				: undefined,
			originBounds,
			originStrokes,
			startDoc,
			startAngle: Math.atan2(startDoc.y - cy, startDoc.x - cx),
		};
		// Taken now so one drag is one undo step; popped again on release if the
		// drag turned out to be a tap.
		this.pushUndo();
	}

	private updateSelectionInput(evt: PointerEvent): void {
		const doc = this.eventDoc(evt);
		if (this.selectionInput === "lasso") {
			this.lasso?.push(doc);
			this.redraw();
			return;
		}
		const drag = this.transformDrag;
		if (!drag) return;
		this.applyToSelection(this.dragMatrix(drag, doc), drag.originStrokes);
		this.redraw();
	}

	private dragMatrix(
		drag: NonNullable<SketchCanvas["transformDrag"]>,
		doc: Vec,
	): Matrix {
		const b = drag.originBounds;
		if (drag.kind === "move") {
			return translation(doc.x - drag.startDoc.x, doc.y - drag.startDoc.y);
		}
		if (drag.kind === "rotate") {
			const cx = (b.minX + b.maxX) / 2;
			const cy = (b.minY + b.maxY) / 2;
			const angle = Math.atan2(doc.y - cy, doc.x - cx);
			return rotateAbout(angle - drag.startAngle, cx, cy);
		}
		// Move the handle by how far the finger has travelled, rather than snapping
		// it to the finger. Grabbing a handle 10px off-centre would otherwise jerk
		// the edge by 10px before you'd moved at all — and a drag that goes nowhere
		// has to come out as exactly the identity, or it leaves an undo entry.
		const origin = drag.handleOrigin ?? drag.startDoc;
		const at = {
			x: origin.x + (doc.x - drag.startDoc.x),
			y: origin.y + (doc.y - drag.startDoc.y),
		};
		return scaleFromHandle(b, drag.handle ?? "se", at, MIN_SELECTION_SIZE);
	}

	private finishSelectionInput(): void {
		const kind = this.selectionInput;
		this.selectionInput = null;

		if (kind === "lasso") {
			const poly = this.lasso ?? [];
			this.lasso = null;
			this.resolveLasso(poly);
			return;
		}

		const drag = this.transformDrag;
		this.transformDrag = null;
		if (!drag) return;
		// Compare against the originals rather than tracking a "moved" flag: a drag
		// that ends where it began should leave no undo entry behind.
		const unchanged = [...drag.originStrokes].every(
			([i, stroke]) => this.doc.strokes[i] === stroke,
		);
		if (unchanged) {
			this.undoStack.pop();
			return;
		}
		this.redoStack = [];
		this.redraw();
		this.options.onChange();
		this.notifySelection();
	}

	/**
	 * Turn a finished boundary into a selection. The path is treated as closed —
	 * lifting your finger snaps the shape shut rather than requiring you to return
	 * to where you started. A boundary too small to be a shape is read as a tap,
	 * which in Replace mode is how you deselect.
	 */
	private resolveLasso(poly: Vec[]): void {
		const pb = polygonBounds(poly);
		if (!pb || poly.length < 3 || boundsSpan(pb) < MIN_LASSO_SPAN) {
			// A tap rather than a boundary. Always deselect, in every mode: the mode
			// shapes the next boundary, it shouldn't make tapping away conditional.
			this.clearSelection();
			return;
		}
		const hit = strokesInPolygon(this.doc.strokes, poly);
		this.selected = mergeSelection(this.selected, hit, this.selectionMode);
		this.redraw();
		this.notifySelection();
	}

	private abortSelectionInput(): void {
		this.cancelLongPress();
		if (!this.selectionInput) return;
		const drag = this.transformDrag;
		if (drag) {
			// Put the originals back and drop the undo entry the drag reserved.
			const next = this.doc.strokes.slice();
			for (const [i, stroke] of drag.originStrokes) next[i] = stroke;
			this.doc.strokes = next;
			this.undoStack.pop();
		}
		this.selectionInput = null;
		this.transformDrag = null;
		this.lasso = null;
	}

	/** The grab radius, in document units, so it's a constant size on screen. */
	private handleInset(): number {
		return HANDLE_TOUCH_RADIUS / this.view.scale;
	}

	/** The handle under a pointer, tested in screen space so zoom doesn't matter. */
	private handleAt(evt: PointerEvent, bounds: Bounds): HandleHit {
		const rect = this.el.getBoundingClientRect();
		const px = evt.clientX - rect.left;
		const py = evt.clientY - rect.top;
		let best: HandleHit = null;
		let bestDist = HANDLE_TOUCH_RADIUS;
		for (const { id, at } of handlePositions(
			bounds,
			ROTATE_HANDLE_OFFSET / this.view.scale,
		)) {
			const s = this.docToScreen(at.x, at.y);
			const d = Math.hypot(s.x - px, s.y - py);
			if (d <= bestDist) {
				bestDist = d;
				best = id;
			}
		}
		return best;
	}

	private eventDoc(evt: PointerEvent): Vec {
		const rect = this.el.getBoundingClientRect();
		return this.screenToDoc(evt.clientX - rect.left, evt.clientY - rect.top);
	}

	/** Document units -> canvas-relative CSS px. The inverse of screenToDoc. */
	private docToScreen(x: number, y: number): Vec {
		const c = Math.cos(this.view.rotation);
		const s = Math.sin(this.view.rotation);
		const sc = this.view.scale;
		return {
			x: this.view.tx + sc * (c * x - s * y),
			y: this.view.ty + sc * (s * x + c * y),
		};
	}

	// --- selection rendering --------------------------------------------

	/**
	 * The boundary while you draw it, then the box and handles once there's a
	 * selection. The box and handles are drawn in *screen* space so they stay a
	 * constant weight at any zoom; the box still follows the page's rotation,
	 * because its corners are projected through the view transform.
	 */
	private drawSelectionOverlay(): void {
		const { ctx } = this;
		if (this.lasso && this.lasso.length > 1) {
			ctx.save();
			ctx.setLineDash([6 / this.view.scale, 4 / this.view.scale]);
			ctx.lineWidth = 1.5 / this.view.scale;
			ctx.strokeStyle = this.accentColor;
			ctx.beginPath();
			ctx.moveTo(this.lasso[0].x, this.lasso[0].y);
			for (const p of this.lasso.slice(1)) ctx.lineTo(p.x, p.y);
			// Closed as you draw, so the shape you're about to get is the shape shown.
			ctx.closePath();
			ctx.stroke();
			ctx.restore();
		}

		const bounds = this.selectionBounds();
		if (!bounds) return;

		// Screen space from here on: handles are sized in CSS px.
		ctx.save();
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

		const corners = [
			this.docToScreen(bounds.minX, bounds.minY),
			this.docToScreen(bounds.maxX, bounds.minY),
			this.docToScreen(bounds.maxX, bounds.maxY),
			this.docToScreen(bounds.minX, bounds.maxY),
		];
		ctx.setLineDash([5, 4]);
		ctx.lineWidth = 1;
		ctx.strokeStyle = this.accentColor;
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y);
		ctx.closePath();
		ctx.stroke();

		const handles = handlePositions(
			bounds,
			ROTATE_HANDLE_OFFSET / this.view.scale,
		);
		ctx.setLineDash([]);
		// The stalk to the rotate handle, so it reads as attached to the box.
		const rotate = handles.find((h) => h.id === "rotate");
		if (rotate) {
			const top = this.docToScreen(
				(bounds.minX + bounds.maxX) / 2,
				bounds.minY,
			);
			const at = this.docToScreen(rotate.at.x, rotate.at.y);
			ctx.beginPath();
			ctx.moveTo(top.x, top.y);
			ctx.lineTo(at.x, at.y);
			ctx.stroke();
		}
		for (const { id, at } of handles) {
			const s = this.docToScreen(at.x, at.y);
			ctx.beginPath();
			ctx.arc(s.x, s.y, HANDLE_RADIUS, 0, Math.PI * 2);
			// Filled with the page colour so a handle stays visible over ink.
			ctx.fillStyle = id === "rotate" ? this.accentColor : this.pageColor;
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
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
