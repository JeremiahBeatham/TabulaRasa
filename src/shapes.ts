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

/**
 * A straight-edged closed shape: three corners for a triangle, four for a
 * rectangle. Held as its corners rather than as a width/height/rotation so a
 * triangle keeps the corners you actually drew — regularising it to equilateral
 * would be inventing a shape you didn't ask for.
 */
export interface PolygonShape {
	kind: "polygon";
	corners: Vec[];
}

export type Shape = LineShape | EllipseShape | PolygonShape;

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
/**
 * Radial error from a perfect ellipse, as a fraction of its radius. Measured
 * against real strokes: a regular pentagon scores 0.111 and a square 0.204, while
 * a circle drawn with 8% radial wobble scores 0.050 and a very shaky one at 12%
 * scores 0.085. 0.10 therefore separates "meant a circle" from "meant a polygon"
 * with room on both sides.
 *
 * Note this can't be done by looking for corners instead: a wobbly circle throws
 * up five to seven false ones, so a corner count would reject exactly the shaky
 * circles the feature is for. A hexagon (0.068) does still read as a circle —
 * accepted, as freehand hexagons are vanishingly rare next to shaky circles.
 */
const ELLIPSE_RMS_TOLERANCE = 0.1;
const ELLIPSE_MAX_TOLERANCE = 0.38;
/** Smaller than this in either axis and the "ellipse" is really a squiggle. */
const ELLIPSE_MIN_RADIUS = 6;

/** How many samples a snapped shape is rebuilt from. */
const LINE_SAMPLES = 16;
const ELLIPSE_SAMPLES = 64;
/**
 * Corners are eased with a small fillet rather than left as hard vertices. A hard
 * vertex makes the stroke renderer mitre the outline to a spike, which reads as
 * pointy and — because the spike length depends on how sharp the angle is —
 * inconsistent between the corners of one shape.
 *
 * The radius is a fraction of the *shorter* adjacent edge so a long thin triangle
 * doesn't get a fillet bigger than its own short side, capped in absolute terms so
 * a large shape doesn't end up looking like a rounded rectangle.
 */
const POLYGON_CORNER_RADIUS_FRAC = 0.12;
const POLYGON_CORNER_MAX_RADIUS = 14;
/**
 * Note there is deliberately no cap on how far a fillet moves a corner's tip. It's
 * tempting: at 90° a 14px fillet shifts the tip 5.8px, but on a 17° sliver the same
 * fillet shifts it 12px and blunts the point. Capping it and letting the radius fall
 * is worse, though — a fillet tighter than the nib makes the inner edge of the band
 * cross itself, and the tip comes out with a notch of bare canvas through it, which
 * is the same defect a hard vertex had. A bounded blunting beats a hole in the ink.
 */
/**
 * Samples along a corner fillet, chosen so no single vertex of the drawn outline
 * carries more than about this much of the turn. Fixed counts don't work: the
 * canvas fills the outline with straight segments, so a vertex holding 100° of turn
 * *is* a point, and an acute corner has far more total turn to spread than a right
 * angle. Measured on a triangle with a ~15° apex, a flat six samples left 106° on
 * one vertex while its other corners sat near 44°, which is the inconsistency
 * between one shape's corners that was reported.
 */
const POLYGON_CORNER_TURN_STEP = (15 * Math.PI) / 180;
const POLYGON_CORNER_MIN_SAMPLES = 6;
const POLYGON_CORNER_MAX_SAMPLES = 20;
/**
 * Samples along the straight run between two fillets. Even, because the run's
 * midpoint has to be one of them — that's where the path is cut open, so the
 * stroke's two round caps land on top of each other in the middle of a straight
 * edge, where they sit flush inside the edge and disappear. Cutting at a corner
 * instead left a visible blob: two caps plus a turn in the same place.
 */
const POLYGON_EDGE_SAMPLES = 6;

/** Corner detection resamples the path to this many evenly spaced points. */
const CORNER_SAMPLES = 64;
/**
 * Turn is measured across this many samples either side. Kept small on purpose:
 * over a ±2 window a 64-sample circle only turns ~22°, while a real corner turns
 * ~90°, so the two can't be confused.
 */
const CORNER_WINDOW = 2;
/**
 * How sharp a turn has to be to be *considered* a corner. Deliberately low: it
 * only filters noise, and the real judge is whether the fitted shape explains the
 * whole stroke. A high threshold made recognition brittle — a square with corners
 * rounded over 30px lost one of them and snapped to nothing.
 */
const CORNER_MIN_TURN = (28 * Math.PI) / 180;
/** Two corners closer than this many samples are the same corner. */
const CORNER_MIN_SEPARATION = 6;
/** A fitted polygon has to pass this close to every point that was drawn. */
const POLYGON_REL_TOLERANCE = 0.09;
const POLYGON_ABS_TOLERANCE = 5;
/** Under this, a rectangle is treated as square to the page rather than tilted. */
const RECT_UPRIGHT_SNAP = (4 * Math.PI) / 180;

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

/** Resample a closed path to `m` evenly spaced points, by arc length. */
export function resampleClosed(points: Vec[], m: number): Vec[] {
	// Close the ring explicitly so the run from last point back to first is walked.
	const ring = points.concat([points[0]]);
	const total = pathLength(ring);
	if (total === 0) return points.slice(0, 1);
	const step = total / m;
	const out: Vec[] = [ring[0]];
	let seg = 1;
	let walked = 0;
	for (let i = 1; i < m; i++) {
		const target = i * step;
		while (seg < ring.length - 1 && walked + dist(ring[seg - 1], ring[seg]) < target) {
			walked += dist(ring[seg - 1], ring[seg]);
			seg++;
		}
		const segLen = dist(ring[seg - 1], ring[seg]) || 1;
		const t = Math.min(1, Math.max(0, (target - walked) / segLen));
		out.push({
			x: ring[seg - 1].x + (ring[seg].x - ring[seg - 1].x) * t,
			y: ring[seg - 1].y + (ring[seg].y - ring[seg - 1].y) * t,
		});
	}
	return out;
}

/**
 * Indices of the sharp turns in a resampled closed path. Treated as a ring, so a
 * corner is found whether or not the stroke happened to start on one — people
 * usually do start a rectangle at a corner, and that must not count twice.
 */
export function detectCorners(ring: Vec[]): number[] {
	const n = ring.length;
	const at = (i: number) => ring[((i % n) + n) % n];
	const turns: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = at(i - CORNER_WINDOW);
		const b = at(i);
		const c = at(i + CORNER_WINDOW);
		const before = Math.atan2(b.y - a.y, b.x - a.x);
		const after = Math.atan2(c.y - b.y, c.x - b.x);
		let turn = after - before;
		while (turn > Math.PI) turn -= Math.PI * 2;
		while (turn < -Math.PI) turn += Math.PI * 2;
		turns.push(Math.abs(turn));
	}

	// Keep only the sharpest sample in each run above the threshold, then drop any
	// that sit within a corner's width of a sharper one.
	const candidates: number[] = [];
	for (let i = 0; i < n; i++) {
		if (turns[i] < CORNER_MIN_TURN) continue;
		let best = true;
		for (let d = -CORNER_WINDOW; d <= CORNER_WINDOW; d++) {
			if (d === 0) continue;
			const j = ((i + d) % n + n) % n;
			if (turns[j] > turns[i]) best = false;
		}
		if (best) candidates.push(i);
	}

	// Sharpest first, so a caller taking the top few gets the most corner-like ones.
	const kept: number[] = [];
	for (const i of candidates.slice().sort((x, y) => turns[y] - turns[x])) {
		const clash = kept.some((j) => {
			const gap = Math.abs(i - j);
			return Math.min(gap, n - gap) < CORNER_MIN_SEPARATION;
		});
		if (!clash) kept.push(i);
	}
	return kept;
}

/** Distance from a point to a line segment. */
function distToSegment(p: Vec, a: Vec, b: Vec): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return dist(p, a);
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = Math.min(1, Math.max(0, t));
	return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Worst distance from any drawn point to the outline of a candidate polygon. */
export function maxDistanceToPolygon(points: Vec[], corners: Vec[]): number {
	let worst = 0;
	for (const p of points) {
		let best = Infinity;
		for (let i = 0; i < corners.length; i++) {
			best = Math.min(
				best,
				distToSegment(p, corners[i], corners[(i + 1) % corners.length]),
			);
		}
		worst = Math.max(worst, best);
	}
	return worst;
}

/**
 * The rectangle that best wraps the drawn points, allowed to be tilted. The
 * orientation is the circular mean of the four edge directions taken modulo 90°,
 * which is why a diamond comes out as a square turned 45° rather than as a
 * mangled upright one. Near-upright fits are snapped level.
 */
function fitRectangle(points: Vec[], corners: Vec[]): Vec[] {
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < corners.length; i++) {
		const a = corners[i];
		const b = corners[(i + 1) % corners.length];
		const angle = Math.atan2(b.y - a.y, b.x - a.x);
		// Angles are equivalent modulo 90° for a rectangle, so average 4× them.
		sx += Math.cos(4 * angle);
		sy += Math.sin(4 * angle);
	}
	let theta = Math.atan2(sy, sx) / 4;
	if (Math.abs(theta) < RECT_UPRIGHT_SNAP) theta = 0;

	const cos = Math.cos(-theta);
	const sin = Math.sin(-theta);
	const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
	const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
	// Measure the extent in the rectangle's own frame, from every drawn point, so
	// the result wraps the shape rather than just its four sharpest samples.
	const local = points.map((p) => ({
		x: (p.x - cx) * cos - (p.y - cy) * sin,
		y: (p.x - cx) * sin + (p.y - cy) * cos,
	}));
	const bb = bounds(local);
	const back = (x: number, y: number): Vec => ({
		x: cx + x * Math.cos(theta) - y * Math.sin(theta),
		y: cy + x * Math.sin(theta) + y * Math.cos(theta),
	});
	return [
		back(bb.minX, bb.minY),
		back(bb.maxX, bb.minY),
		back(bb.maxX, bb.maxY),
		back(bb.minX, bb.maxY),
	];
}

/**
 * A closed stroke with three or four sharp corners and straight edges between
 * them. Anything else — five corners, a bowed edge, a sheared parallelogram —
 * is left as drawn rather than forced into a shape it isn't.
 */
function looksLikePolygon(points: Vec[], length: number): PolygonShape | null {
	const gap = dist(points[0], points[points.length - 1]);
	if (gap > Math.max(CLOSE_ABS_TOLERANCE, length * CLOSE_REL_TOLERANCE)) {
		return null;
	}
	const bb = bounds(points);
	const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
	if (span < SNAP_MIN_LENGTH) return null;
	const tolerance = Math.max(
		POLYGON_ABS_TOLERANCE,
		span * POLYGON_REL_TOLERANCE,
	);

	const ring = resampleClosed(points, CORNER_SAMPLES);
	const ranked = detectCorners(ring);
	if (ranked.length < 3) return null;

	// Try four corners then three, rather than demanding the detector return
	// exactly the right count. Counting corners is the fragile part — rounded
	// corners lose one, a shaky edge invents one — while "does this shape explain
	// the stroke" is a solid test, so let the fit decide and only use the corner
	// ranking to propose candidates.
	for (const count of [4, 3]) {
		if (ranked.length < count) continue;
		// Back into path order, so the corners form the outline rather than criss-cross.
		const chosen = ranked
			.slice(0, count)
			.sort((a, b) => a - b)
			.map((i) => ring[i]);
		const fitted = count === 4 ? fitRectangle(points, chosen) : chosen;
		if (maxDistanceToPolygon(points, fitted) <= tolerance) {
			return { kind: "polygon", corners: fitted };
		}
	}
	return null;
}

/**
 * The shape a stroke is trying to be, or null to leave it alone.
 *
 * Order matters. Line first: its ends are far apart, so it can't also be closed.
 * Then ellipse, because a circle has no corners for the polygon test to find and
 * checking it first keeps a round shape from ever being read as a many-sided one.
 */
export function recogniseShape(points: Point[]): Shape | null {
	if (points.length < SNAP_MIN_POINTS) return null;
	const length = pathLength(points);
	if (length < SNAP_MIN_LENGTH) return null;
	return (
		looksLikeLine(points) ??
		looksLikeEllipse(points, length) ??
		looksLikePolygon(points, length)
	);
}

/** The point `r` along the way from `from` toward `to`. */
function towards(from: Vec, to: Vec, r: number): Vec {
	const len = dist(from, to) || 1;
	return { x: from.x + ((to.x - from.x) / len) * r, y: from.y + ((to.y - from.y) / len) * r };
}

function lerp(a: Vec, b: Vec, t: number): Vec {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The arc that rounds one corner: a circle tangent to both edges, `trim` back from
 * the corner along each. Returned as samples spaced by equal *angle*, which is the
 * point of using an arc rather than a Bézier through the corner — a Bézier's
 * curvature bunches up in its middle, so on an acute corner uniform sampling
 * under-samples the very part that turns hardest and leaves a visible point there.
 *
 * Returns null when the corner isn't really a corner (collinear edges), leaving the
 * caller to run straight through it.
 */
function cornerArc(prev: Vec, cur: Vec, next: Vec, trim: number): Vec[] | null {
	const toPrev = towards(cur, prev, 1);
	const toNext = towards(cur, next, 1);
	const u1 = { x: toPrev.x - cur.x, y: toPrev.y - cur.y };
	const u2 = { x: toNext.x - cur.x, y: toNext.y - cur.y };
	// Interior angle at the corner, and the bisector the arc's centre sits on.
	const interior = Math.acos(Math.min(1, Math.max(-1, u1.x * u2.x + u1.y * u2.y)));
	const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
	const bisLen = Math.hypot(bisector.x, bisector.y);
	const sweep = Math.PI - interior;
	if (trim <= 0 || bisLen < 1e-6 || sweep < 1e-3) return null;

	const half = interior / 2;
	const centreDist = trim / Math.max(1e-6, Math.cos(half));
	const centre = {
		x: cur.x + (bisector.x / bisLen) * centreDist,
		y: cur.y + (bisector.y / bisLen) * centreDist,
	};
	const entry = { x: cur.x + u1.x * trim, y: cur.y + u1.y * trim };
	const exit = { x: cur.x + u2.x * trim, y: cur.y + u2.y * trim };
	const from = Math.atan2(entry.y - centre.y, entry.x - centre.x);
	const to = Math.atan2(exit.y - centre.y, exit.x - centre.x);
	let delta = to - from;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;
	const radius = Math.hypot(entry.x - centre.x, entry.y - centre.y);

	const samples = Math.min(
		POLYGON_CORNER_MAX_SAMPLES,
		Math.max(
			POLYGON_CORNER_MIN_SAMPLES,
			Math.ceil(Math.abs(delta) / POLYGON_CORNER_TURN_STEP),
		),
	);
	const out: Vec[] = [];
	for (let i = 0; i <= samples; i++) {
		const a = from + (delta * i) / samples;
		out.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
	}
	return out;
}

/**
 * A polygon's outline as a closed ring of samples, with each corner eased into a
 * small fillet, plus the index to start drawing from.
 *
 * Two things are going on. The fillets replace hard vertices, which the stroke
 * renderer would otherwise mitre into a spike whose length depends on how sharp
 * the angle is — that's what made one shape's corners look inconsistent with each
 * other. And the seam is placed at the midpoint of the *longest* straight run: a
 * stroke gets a round cap at each end, and a cap of radius size/2 centred on the
 * centreline of an edge of half-width size/2 sits entirely inside that edge, so
 * both caps vanish. On a corner they don't — the band turns away underneath them.
 */
export function polygonRing(corners: Vec[]): { ring: Vec[]; seam: number } {
	const n = corners.length;
	const at = (i: number) => corners[((i % n) + n) % n];

	const radii: number[] = [];
	for (let c = 0; c < n; c++) {
		const prevLen = dist(at(c - 1), at(c));
		const nextLen = dist(at(c), at(c + 1));
		radii.push(
			Math.max(
				0,
				Math.min(
					POLYGON_CORNER_MAX_RADIUS,
					POLYGON_CORNER_RADIUS_FRAC * Math.min(prevLen, nextLen),
					// Never more than a third of either adjacent edge, so the two
					// fillets sharing an edge always leave a straight run between them.
					prevLen / 3,
					nextLen / 3,
				),
			),
		);
	}

	// Every corner's arc up front, so both ends of an edge agree on where the
	// straight run between them starts and stops even if one corner degenerates.
	const arcs = corners.map((cur, c) => cornerArc(at(c - 1), cur, at(c + 1), radii[c]) ?? [cur]);

	const ring: Vec[] = [];
	let seam = 0;
	let seamLen = -1;
	for (let c = 0; c < n; c++) {
		const arc = arcs[c];
		for (const v of arc) ring.push(v);

		const exit = arc[arc.length - 1];
		const nextArc = arcs[(c + 1) % n];
		const nextEntry = nextArc[0];
		const runStart = ring.length;
		for (let i = 1; i < POLYGON_EDGE_SAMPLES; i++) {
			ring.push(lerp(exit, nextEntry, i / POLYGON_EDGE_SAMPLES));
		}
		const runLen = dist(exit, nextEntry);
		if (runLen > seamLen) {
			seamLen = runLen;
			seam = runStart + POLYGON_EDGE_SAMPLES / 2 - 1;
		}
	}
	return { ring, seam };
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
	if (shape.kind === "polygon") {
		const { ring, seam } = polygonRing(shape.corners);
		const out: Point[] = [];
		// Walk the whole ring from the seam and back to it, so the path opens and
		// closes at the same mid-edge point rather than at a corner.
		for (let i = 0; i <= ring.length; i++) {
			const v = ring[(seam + i) % ring.length];
			out.push({ x: v.x, y: v.y, p });
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
