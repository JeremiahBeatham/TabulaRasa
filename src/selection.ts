import { Stroke } from "./model";

/**
 * Selection geometry, kept free of DOM and canvas state so it can be reasoned
 * about (and tested) on its own. Everything here works in *document* units —
 * the canvas converts from screen coordinates before calling in.
 */

export interface Vec {
	x: number;
	y: number;
}

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** How a fresh lasso combines with whatever is already selected. */
export type SelectionMode = "replace" | "add" | "subtract";

/**
 * A stroke counts as selected when at least this much of it falls inside the
 * lasso. Requiring the whole stroke makes long lines almost impossible to catch;
 * accepting any overlap grabs neighbours you were drawing around. Half is the
 * rule that matches what people seem to mean by "inside".
 */
export const SELECTION_MIN_COVERAGE = 0.5;

/** A lasso shorter than this (in document units) is a stray tap, not a shape. */
export const MIN_LASSO_SPAN = 6;

/** 2D affine transform: [a c e / b d f / 0 0 1]. */
export interface Matrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(dx: number, dy: number): Matrix {
	return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

/** Scale about a fixed point, so the anchor corner/edge stays put. */
export function scaleAbout(
	sx: number,
	sy: number,
	cx: number,
	cy: number,
): Matrix {
	return { a: sx, b: 0, c: 0, d: sy, e: cx * (1 - sx), f: cy * (1 - sy) };
}

export function rotateAbout(rad: number, cx: number, cy: number): Matrix {
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return {
		a: cos,
		b: sin,
		c: -sin,
		d: cos,
		e: cx - cos * cx + sin * cy,
		f: cy - sin * cx - cos * cy,
	};
}

export function flipAbout(axis: "horizontal" | "vertical", b: Bounds): Matrix {
	const cx = (b.minX + b.maxX) / 2;
	const cy = (b.minY + b.maxY) / 2;
	// "Flip horizontal" mirrors left-to-right, i.e. negates x.
	return axis === "horizontal"
		? scaleAbout(-1, 1, cx, cy)
		: scaleAbout(1, -1, cx, cy);
}

export function applyMatrix(m: Matrix, x: number, y: number): Vec {
	return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function isIdentity(m: Matrix, eps = 1e-9): boolean {
	return (
		Math.abs(m.a - 1) < eps &&
		Math.abs(m.b) < eps &&
		Math.abs(m.c) < eps &&
		Math.abs(m.d - 1) < eps &&
		Math.abs(m.e) < eps &&
		Math.abs(m.f) < eps
	);
}

/**
 * How much a transform changes stroke width. The geometric mean of the two axis
 * scales, which is exact for a uniform scale or a rotation and stays sensible
 * when a side handle stretches one axis — there is no single "correct" width for
 * a non-uniformly scaled round nib, but a line that grows must get thicker.
 * Mirroring (a negative determinant) must not flip the width negative.
 */
export function strokeWidthFactor(m: Matrix): number {
	return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

/**
 * Transform a stroke into a new object. Fresh objects matter: undo snapshots
 * share stroke instances with the live document, so mutating in place would
 * rewrite history as well as the present.
 */
export function transformStroke(stroke: Stroke, m: Matrix): Stroke {
	const factor = strokeWidthFactor(m);
	return {
		...stroke,
		size: stroke.size * factor,
		points: stroke.points.map((pt) => {
			const p = applyMatrix(m, pt.x, pt.y);
			return { x: p.x, y: p.y, p: pt.p };
		}),
	};
}

/**
 * Ray casting. The polygon is treated as closed — the caller never has to append
 * a duplicate of the first point, which is also how the lasso "snaps shut" when
 * a finger lifts without the path having crossed itself.
 */
export function pointInPolygon(x: number, y: number, poly: Vec[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const xi = poly[i].x;
		const yi = poly[i].y;
		const xj = poly[j].x;
		const yj = poly[j].y;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

export function polygonBounds(poly: Vec[]): Bounds | null {
	if (poly.length === 0) return null;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const p of poly) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { minX, minY, maxX, maxY };
}

export function boundsSpan(b: Bounds): number {
	return Math.max(b.maxX - b.minX, b.maxY - b.minY);
}

export function boundsContain(b: Bounds, x: number, y: number): boolean {
	return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/**
 * Shrink bounds by `inset` on every side. Used to reserve a middle region that
 * always means "move this", separate from the band near the edges where the
 * scale handles live. Never collapses: the inset is capped at a third of the
 * shorter side, so even a tiny selection keeps a movable core.
 */
export function insetBounds(b: Bounds, inset: number): Bounds {
	const limit = Math.min(b.maxX - b.minX, b.maxY - b.minY) / 3;
	const d = Math.max(0, Math.min(inset, limit));
	return {
		minX: b.minX + d,
		minY: b.minY + d,
		maxX: b.maxX - d,
		maxY: b.maxY - d,
	};
}

/** Fraction of a stroke's points that fall inside the lasso. */
export function strokeCoverage(stroke: Stroke, poly: Vec[]): number {
	if (stroke.points.length === 0) return 0;
	let inside = 0;
	for (const pt of stroke.points) {
		if (pointInPolygon(pt.x, pt.y, poly)) inside++;
	}
	return inside / stroke.points.length;
}

/** Indices of the strokes the lasso caught, in document order. */
export function strokesInPolygon(
	strokes: Stroke[],
	poly: Vec[],
	minCoverage = SELECTION_MIN_COVERAGE,
): number[] {
	const pb = polygonBounds(poly);
	if (!pb || poly.length < 3) return [];
	const hit: number[] = [];
	for (let i = 0; i < strokes.length; i++) {
		const sb = strokeBounds(strokes[i]);
		// Cheap reject before the per-point test.
		if (
			!sb ||
			sb.maxX < pb.minX ||
			sb.minX > pb.maxX ||
			sb.maxY < pb.minY ||
			sb.minY > pb.maxY
		) {
			continue;
		}
		if (strokeCoverage(strokes[i], poly) >= minCoverage) hit.push(i);
	}
	return hit;
}

export function mergeSelection(
	current: ReadonlySet<number>,
	hit: number[],
	mode: SelectionMode,
): Set<number> {
	if (mode === "replace") return new Set(hit);
	const next = new Set(current);
	for (const i of hit) {
		if (mode === "add") next.add(i);
		else next.delete(i);
	}
	return next;
}

/** Bounds of one stroke, inflated by its half-width so the box wraps the ink. */
export function strokeBounds(stroke: Stroke): Bounds | null {
	if (stroke.points.length === 0) return null;
	const r = stroke.size / 2;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const pt of stroke.points) {
		minX = Math.min(minX, pt.x - r);
		minY = Math.min(minY, pt.y - r);
		maxX = Math.max(maxX, pt.x + r);
		maxY = Math.max(maxY, pt.y + r);
	}
	return { minX, minY, maxX, maxY };
}

export function unionBounds(strokes: Stroke[]): Bounds | null {
	let out: Bounds | null = null;
	for (const stroke of strokes) {
		const b = strokeBounds(stroke);
		if (!b) continue;
		out = out
			? {
					minX: Math.min(out.minX, b.minX),
					minY: Math.min(out.minY, b.minY),
					maxX: Math.max(out.maxX, b.maxX),
					maxY: Math.max(out.maxY, b.maxY),
				}
			: b;
	}
	return out;
}

/**
 * The eight scale handles plus the rotate handle. `rotateOffset` is in document
 * units — the canvas converts a fixed screen distance so the handle sits the
 * same distance above the box at any zoom.
 */
export type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type HandleId = ScaleHandle | "rotate";

export const SCALE_HANDLES: ScaleHandle[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];

export function handlePositions(
	b: Bounds,
	rotateOffset: number,
): { id: HandleId; at: Vec }[] {
	const midX = (b.minX + b.maxX) / 2;
	const midY = (b.minY + b.maxY) / 2;
	const at: Record<HandleId, Vec> = {
		nw: { x: b.minX, y: b.minY },
		n: { x: midX, y: b.minY },
		ne: { x: b.maxX, y: b.minY },
		e: { x: b.maxX, y: midY },
		se: { x: b.maxX, y: b.maxY },
		s: { x: midX, y: b.maxY },
		sw: { x: b.minX, y: b.maxY },
		w: { x: b.minX, y: midY },
		rotate: { x: midX, y: b.minY - rotateOffset },
	};
	return ([...SCALE_HANDLES, "rotate"] as HandleId[]).map((id) => ({
		id,
		at: at[id],
	}));
}

/** Which edges a handle drags. Corners move two, sides one. */
function handleEdges(h: ScaleHandle): {
	left: boolean;
	right: boolean;
	top: boolean;
	bottom: boolean;
} {
	return {
		left: h === "nw" || h === "w" || h === "sw",
		right: h === "ne" || h === "e" || h === "se",
		top: h === "nw" || h === "n" || h === "ne",
		bottom: h === "sw" || h === "s" || h === "se",
	};
}

/**
 * The transform for dragging `handle` to `p`. The opposite edge stays anchored,
 * and each axis is kept at least `minSize` wide so a selection can't be crushed
 * to nothing (or turned inside out) by an overshooting finger.
 */
export function scaleFromHandle(
	orig: Bounds,
	handle: ScaleHandle,
	p: Vec,
	minSize: number,
): Matrix {
	const e = handleEdges(handle);
	const width = orig.maxX - orig.minX;
	const height = orig.maxY - orig.minY;

	let sx = 1;
	let ax = orig.minX;
	if (e.left && width > 0) {
		const newMinX = Math.min(p.x, orig.maxX - minSize);
		sx = (orig.maxX - newMinX) / width;
		ax = orig.maxX;
	} else if (e.right && width > 0) {
		const newMaxX = Math.max(p.x, orig.minX + minSize);
		sx = (newMaxX - orig.minX) / width;
		ax = orig.minX;
	}

	let sy = 1;
	let ay = orig.minY;
	if (e.top && height > 0) {
		const newMinY = Math.min(p.y, orig.maxY - minSize);
		sy = (orig.maxY - newMinY) / height;
		ay = orig.maxY;
	} else if (e.bottom && height > 0) {
		const newMaxY = Math.max(p.y, orig.minY + minSize);
		sy = (newMaxY - orig.minY) / height;
		ay = orig.minY;
	}

	return scaleAbout(sx, sy, ax, ay);
}
