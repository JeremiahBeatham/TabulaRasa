import { Point } from "./model";

/**
 * Shape recognition for hold-to-snap: pause at the end of a stroke and a rough
 * line or circle becomes a clean one.
 *
 * No DOM and no canvas state, so the judgement calls — how straight is straight,
 * how round is round — can be tested against real coordinates rather than argued
 * about. Recognition only ever *offers* a shape; the canvas decides what to do
 * with it.
 */

export interface Vec {
	x: number;
	y: number;
}

export interface LineShape {
	kind: "line";
	from: Vec;
	to: Vec;
}

/** Axis-aligned. A tilted ellipse is rare freehand; a circle is the common case. */
export interface EllipseShape {
	kind: "ellipse";
	cx: number;
	cy: number;
	rx: number;
	ry: number;
}

export type Shape = LineShape | EllipseShape;

/** Below this many samples there isn't enough evidence to call a shape. */
export const SNAP_MIN_POINTS = 8;
/** Nor below this much travel, in document units — that's a dot or a tick. */
export const SNAP_MIN_LENGTH = 24;

/** A line may bow by this much: the larger of a fraction of its span, or a floor. */
const LINE_REL_TOLERANCE = 0.06;
const LINE_ABS_TOLERANCE = 4;
/**
 * How far a point may sit past either end of the chord, as a fraction of it. This
 * is what rejects a stroke drawn there-and-back: its far end projects way beyond
 * the chord between its endpoints.
 *
 * Deliberately measured by projection rather than by comparing path length to
 * chord length. Path length is inflated by the very jitter a hand-drawn line has
 * — sampling a shaky 150px line finely can add 40% — so a path-ratio guard
 * rejected exactly the strokes this feature exists to clean up.
 */
const LINE_MAX_OVERSHOOT = 0.15;

/** How far the ends of a loop may sit apart and still count as closed. */
const CLOSE_REL_TOLERANCE = 0.25;
const CLOSE_ABS_TOLERANCE = 12;
/** Radial error from a perfect ellipse, as a fraction of its radius. */
const ELLIPSE_RMS_TOLERANCE = 0.16;
const ELLIPSE_MAX_TOLERANCE = 0.38;
/** Smaller than this in either axis and the "ellipse" is really a squiggle. */
const ELLIPSE_MIN_RADIUS = 6;

/** How many samples a snapped shape is rebuilt from. */
const LINE_SAMPLES = 16;
const ELLIPSE_SAMPLES = 64;

function dist(a: Vec, b: Vec): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(points: Vec[]): number {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
	return total;
}

export function bounds(points: Vec[]): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { minX, minY, maxX, maxY };
}

/** Largest perpendicular distance from the straight line through the two ends. */
export function maxDeviationFromChord(points: Vec[]): number {
	const a = points[0];
	const b = points[points.length - 1];
	const len = dist(a, b);
	if (len === 0) {
		// Ends meet: measure from the start instead, so a loop can't look straight.
		return Math.max(...points.map((p) => dist(a, p)));
	}
	const ux = (b.x - a.x) / len;
	const uy = (b.y - a.y) / len;
	let worst = 0;
	for (const p of points) {
		// Cross product of the unit chord with the offset = perpendicular distance.
		worst = Math.max(worst, Math.abs(ux * (p.y - a.y) - uy * (p.x - a.x)));
	}
	return worst;
}

function looksLikeLine(points: Vec[]): LineShape | null {
	const a = points[0];
	const b = points[points.length - 1];
	const chord = dist(a, b);
	if (chord < SNAP_MIN_LENGTH) return null;

	// Nothing may run off either end: that's what a stroke doubling back does.
	const ux = (b.x - a.x) / chord;
	const uy = (b.y - a.y) / chord;
	for (const p of points) {
		const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / chord;
		if (t < -LINE_MAX_OVERSHOOT || t > 1 + LINE_MAX_OVERSHOOT) return null;
	}

	const tolerance = Math.max(LINE_ABS_TOLERANCE, chord * LINE_REL_TOLERANCE);
	if (maxDeviationFromChord(points) > tolerance) return null;
	return { kind: "line", from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
}

function looksLikeEllipse(points: Vec[], length: number): EllipseShape | null {
	const a = points[0];
	const b = points[points.length - 1];
	const gap = dist(a, b);
	const closeTolerance = Math.max(
		CLOSE_ABS_TOLERANCE,
		length * CLOSE_REL_TOLERANCE,
	);
	if (gap > closeTolerance) return null;

	const bb = bounds(points);
	const cx = (bb.minX + bb.maxX) / 2;
	const cy = (bb.minY + bb.maxY) / 2;
	const rx = (bb.maxX - bb.minX) / 2;
	const ry = (bb.maxY - bb.minY) / 2;
	if (rx < ELLIPSE_MIN_RADIUS || ry < ELLIPSE_MIN_RADIUS) return null;

	// Every point should sit about one radius from the centre, measured in the
	// ellipse's own units.
	let sumSq = 0;
	let worst = 0;
	const quadrants = new Set<number>();
	for (const p of points) {
		const nx = (p.x - cx) / rx;
		const ny = (p.y - cy) / ry;
		const r = Math.hypot(nx, ny);
		const error = Math.abs(r - 1);
		sumSq += error * error;
		worst = Math.max(worst, error);
		quadrants.add((nx >= 0 ? 1 : 0) + (ny >= 0 ? 2 : 0));
	}
	const rms = Math.sqrt(sumSq / points.length);
	if (rms > ELLIPSE_RMS_TOLERANCE || worst > ELLIPSE_MAX_TOLERANCE) return null;
	// All four quadrants, so a shape that only bulges one way can't qualify.
	if (quadrants.size < 4) return null;

	return { kind: "ellipse", cx, cy, rx, ry };
}

/**
 * The shape a stroke is trying to be, or null to leave it alone. Line is tested
 * first: a line's ends are far apart, so the two tests can't both fire.
 */
export function recogniseShape(points: Point[]): Shape | null {
	if (points.length < SNAP_MIN_POINTS) return null;
	const length = pathLength(points);
	if (length < SNAP_MIN_LENGTH) return null;
	return looksLikeLine(points) ?? looksLikeEllipse(points, length);
}

/**
 * Rebuild a shape as stroke samples. Pressure is constant — a snapped shape with
 * the original's pressure wobble would keep the shakiness the snap was meant to
 * remove — and the caller pairs this with simulatePressure off for the same reason.
 */
export function shapePoints(shape: Shape, pressure: number): Point[] {
	const p = Math.min(1, Math.max(0.05, pressure));
	if (shape.kind === "line") {
		const out: Point[] = [];
		for (let i = 0; i <= LINE_SAMPLES; i++) {
			const t = i / LINE_SAMPLES;
			out.push({
				x: shape.from.x + (shape.to.x - shape.from.x) * t,
				y: shape.from.y + (shape.to.y - shape.from.y) * t,
				p,
			});
		}
		return out;
	}
	const out: Point[] = [];
	// One extra sample closes the loop exactly on its start.
	for (let i = 0; i <= ELLIPSE_SAMPLES; i++) {
		const t = (i / ELLIPSE_SAMPLES) * Math.PI * 2;
		out.push({
			x: shape.cx + Math.cos(t) * shape.rx,
			y: shape.cy + Math.sin(t) * shape.ry,
			p,
		});
	}
	return out;
}

/** Mean pressure of a stroke, for handing to shapePoints. */
export function meanPressure(points: Point[]): number {
	if (points.length === 0) return 0.5;
	return points.reduce((sum, pt) => sum + pt.p, 0) / points.length;
}
