/**
 * Multi-finger double-tap gestures for undo/redo.
 *
 *   two fingers, double tap  → undo
 *   three fingers, double tap → redo
 *
 * Two-finger *dragging* is pan/zoom/twist, so a two-finger gesture can only
 * mean undo when the fingers didn't travel. That's the whole trick here: taps
 * are recognised by the absence of movement, which keeps them out of the way
 * of panning entirely.
 *
 * Classification is pure so it can be tested without synthesising multi-touch.
 */

export type GestureAction = "undo" | "redo";

export interface PointerSample {
	x: number;
	y: number;
}

/** One completed touch — every finger down, then every finger up again. */
export interface TouchSequence {
	/** Peak simultaneous pointers during the touch. */
	fingers: number;
	/** Furthest the centroid strayed from where it started, in CSS px. */
	travel: number;
	durationMs: number;
	/** When the last finger lifted. */
	endedAt: number;
}

export interface GestureSettings {
	enabled: boolean;
}

export const DEFAULT_GESTURE_SETTINGS: GestureSettings = { enabled: true };

/** Beyond this much centroid movement it's a drag, not a tap. */
export const TAP_MAX_TRAVEL = 18;
/** A tap has to be brisk; longer means a hold or a slow pan. */
export const TAP_MAX_MS = 320;
/** Maximum gap between the two taps of a double tap. */
export const DOUBLE_TAP_MAX_GAP_MS = 450;

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

export function isTap(seq: TouchSequence): boolean {
	return seq.travel <= TAP_MAX_TRAVEL && seq.durationMs <= TAP_MAX_MS;
}

/** Which action a given finger count maps to, if any. */
export function actionForFingers(fingers: number): GestureAction | null {
	if (fingers === 2) return "undo";
	if (fingers === 3) return "redo";
	return null;
}

/**
 * Feeds completed touches in and reports an action when two matching taps
 * arrive close enough together.
 */
export class DoubleTapRecognizer {
	private pending: { fingers: number; at: number } | null = null;

	/** Returns an action if this touch completed a double tap, else null. */
	push(
		seq: TouchSequence,
		settings: GestureSettings = DEFAULT_GESTURE_SETTINGS,
	): GestureAction | null {
		if (!settings.enabled) {
			this.pending = null;
			return null;
		}
		if (!isTap(seq)) {
			// A drag in the middle of things breaks any half-finished double tap.
			this.pending = null;
			return null;
		}
		const action = actionForFingers(seq.fingers);
		if (!action) {
			this.pending = null;
			return null;
		}

		const prior = this.pending;
		if (
			prior &&
			prior.fingers === seq.fingers &&
			seq.endedAt - prior.at <= DOUBLE_TAP_MAX_GAP_MS
		) {
			// Consume the pair so a triple tap doesn't fire twice.
			this.pending = null;
			return action;
		}

		this.pending = { fingers: seq.fingers, at: seq.endedAt };
		return null;
	}

	reset(): void {
		this.pending = null;
	}
}

/**
 * Accumulates live pointer positions into a TouchSequence. Thin on purpose —
 * the judgement lives in DoubleTapRecognizer.
 */
export class TouchSequenceTracker {
	private origin: PointerSample;
	private fingers: number;
	private travel = 0;
	private startedAt: number;

	constructor(points: PointerSample[], now: number = Date.now()) {
		this.origin = centroid(points);
		this.fingers = points.length;
		this.startedAt = now;
	}

	update(points: PointerSample[]): void {
		if (!points.length) return;
		this.fingers = Math.max(this.fingers, points.length);
		const c = centroid(points);
		this.travel = Math.max(
			this.travel,
			Math.hypot(c.x - this.origin.x, c.y - this.origin.y),
		);
	}

	finish(now: number = Date.now()): TouchSequence {
		return {
			fingers: this.fingers,
			travel: this.travel,
			durationMs: now - this.startedAt,
			endedAt: now,
		};
	}
}
