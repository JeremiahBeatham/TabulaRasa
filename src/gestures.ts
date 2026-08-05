/**
 * Three-finger gesture recognition for undo/redo.
 *
 * Why three fingers and not two: the canvas already turns *any* second pointer
 * into a pan/zoom/twist gesture, so every two-finger combination is spoken for.
 * Three fingers is also what iOS itself uses for undo/redo, so the gesture is
 * one users are likely to already know.
 *
 * The classification is a pure function over a recorded track so it can be
 * tested without synthesising real multi-touch.
 */

export type GestureAction = "undo" | "redo";

export interface PointerSample {
	x: number;
	y: number;
}

/** A completed multi-finger gesture, reduced to the parts we classify on. */
export interface GestureTrack {
	/** Peak simultaneous pointers. Exactly 3 is required to mean anything. */
	maxPointers: number;
	/** Centroid of the pointers when the gesture began. */
	startX: number;
	startY: number;
	/** Centroid when the last finger lifted. */
	endX: number;
	endY: number;
	durationMs: number;
}

export interface GestureSettings {
	enabled: boolean;
	/** Apple's order: swipe left undoes, swipe right redoes. */
	swipeLeftUndo: boolean;
	/** Whether a three-finger tap also undoes. */
	tapUndo: boolean;
}

export const DEFAULT_GESTURE_SETTINGS: GestureSettings = {
	enabled: true,
	swipeLeftUndo: true,
	tapUndo: true,
};

/** Minimum horizontal travel (CSS px) before a drag counts as a swipe. */
export const SWIPE_MIN_DISTANCE = 48;
/** A swipe must be this much more horizontal than vertical, so scrolls don't count. */
export const SWIPE_AXIS_RATIO = 1.5;
/** Maximum centroid travel for the gesture to still read as a tap. */
export const TAP_MAX_TRAVEL = 16;
/** Maximum duration for a tap. */
export const TAP_MAX_MS = 400;

export function centroid(points: PointerSample[]): PointerSample {
	if (!points.length) return { x: 0, y: 0 };
	let x = 0;
	let y = 0;
	for (const p of points) {
		x += p.x;
		y += p.y;
	}
	return { x: x / points.length, y: y / points.length };
}

/**
 * Decide what a finished gesture meant. Returns null for anything ambiguous —
 * a missed gesture is recoverable, a wrongly-fired undo destroys work.
 */
export function classifyGesture(
	track: GestureTrack,
	settings: GestureSettings = DEFAULT_GESTURE_SETTINGS,
): GestureAction | null {
	if (!settings.enabled) return null;
	// Exactly three: two is pan/zoom, four or more is probably a system gesture.
	if (track.maxPointers !== 3) return null;

	const dx = track.endX - track.startX;
	const dy = track.endY - track.startY;
	const travel = Math.hypot(dx, dy);

	if (travel <= TAP_MAX_TRAVEL) {
		if (track.durationMs > TAP_MAX_MS) return null;
		return settings.tapUndo ? "undo" : null;
	}

	const horizontal = Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
		Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO;
	if (!horizontal) return null;

	const wentLeft = dx < 0;
	if (settings.swipeLeftUndo) return wentLeft ? "undo" : "redo";
	return wentLeft ? "redo" : "undo";
}

/**
 * Accumulates live pointer positions into a GestureTrack. Kept deliberately
 * thin — all the judgement lives in classifyGesture.
 */
export class GestureTracker {
	private startPoint: PointerSample;
	private endPoint: PointerSample;
	private maxPointers: number;
	private startedAt: number;

	constructor(points: PointerSample[], now: number = Date.now()) {
		this.startPoint = centroid(points);
		this.endPoint = this.startPoint;
		this.maxPointers = points.length;
		this.startedAt = now;
	}

	update(points: PointerSample[]): void {
		if (!points.length) return;
		this.maxPointers = Math.max(this.maxPointers, points.length);
		this.endPoint = centroid(points);
	}

	finish(now: number = Date.now()): GestureTrack {
		return {
			maxPointers: this.maxPointers,
			startX: this.startPoint.x,
			startY: this.startPoint.y,
			endX: this.endPoint.x,
			endY: this.endPoint.y,
			durationMs: now - this.startedAt,
		};
	}
}
