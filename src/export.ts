import { getStroke } from "perfect-freehand";
import { Point, SketchDoc, Stroke, ToolName } from "./model";

interface ToolStrokeOptions {
	thinning: number;
	smoothing: number;
	streamline: number;
	/** Fraction of the brush size used to taper the stroke's ends. */
	taper: number;
	/** Multiplier on the brush size, so a tool can run heavier by default. */
	weight: number;
	/**
	 * Ragged edge, in fractions of the brush size. Perfect-freehand returns a
	 * smooth polygon; nudging its vertices outward and inward roughens the
	 * silhouette, which is what reads as wax or charcoal rather than ink.
	 */
	grain: number;
}

/**
 * Per-tool feel. These are the only thing separating one nib from another, so
 * changing a number here changes how that tool draws everywhere at once —
 * live canvas, PNG export and SVG export all render through strokeToOutline.
 *
 * The brush trades the pen's evenness for character: it swells and thins far
 * more with pressure (high thinning), follows the hand instead of smoothing
 * the wobble away (low streamline), and tapers at both ends like a loaded
 * bristle leaving and lifting off the page.
 */
const CRAYON_OPTIONS: ToolStrokeOptions = {
	thinning: 0.42,
	smoothing: 0.34,
	streamline: 0.28,
	taper: 0.25,
	weight: 1.7,
	grain: 0.16,
};

export const TOOL_STROKE_OPTIONS: Record<ToolName, ToolStrokeOptions> = {
	pen: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, taper: 0, weight: 1, grain: 0 },
	crayon: CRAYON_OPTIONS,
	// Legacy alias: strokes saved as "brush" before the crayon rename.
	brush: CRAYON_OPTIONS,
	highlighter: {
		thinning: 0.18,
		smoothing: 0.5,
		streamline: 0.55,
		taper: 0,
		weight: 1.25,
		grain: 0,
	},
	eraser: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, taper: 0, weight: 1, grain: 0 },
	// Never used: the selection tool creates no strokes. Present so the table stays
	// exhaustive over ToolName and a new tool can't be added without a decision.
	select: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, taper: 0, weight: 1, grain: 0 },
};

/**
 * Deterministic pseudo-random in [-1, 1] seeded by a *position*, not by a vertex
 * index. Seeding by index shimmered while drawing: perfect-freehand returns the
 * outline as one side forward then the other back, so appending a point shifts
 * the index of every vertex on the return side and re-rolled their grain on each
 * frame. Position is stable as the stroke grows, and identical in both export
 * paths. Quantised so float drift between those paths can't change the roll.
 */
function jitter(x: number, y: number): number {
	const qx = Math.round(x * 4) / 4;
	const qy = Math.round(y * 4) / 4;
	const s = Math.sin(qx * 12.9898 + qy * 78.233) * 43758.5453;
	return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Roughen an outline by pushing each vertex along its own normal. Applied after
 * perfect-freehand so the stroke keeps its shape and only its edge turns grainy.
 */
function roughen(outline: number[][], amount: number): number[][] {
	if (amount <= 0 || outline.length < 3) return outline;
	const n = outline.length;
	return outline.map(([x, y], i) => {
		const [px, py] = outline[(i - 1 + n) % n];
		const [nx, ny] = outline[(i + 1) % n];
		// Normal of the local tangent, so vertices move perpendicular to the edge.
		let tx = ny - py;
		let ty = -(nx - px);
		const len = Math.hypot(tx, ty) || 1;
		tx /= len;
		ty /= len;
		const d = jitter(x, y) * amount;
		return [x + tx * d, y + ty * d];
	});
}

/**
 * Beyond this ratio of nib widths, an inner corner is bevelled instead of mitred.
 * The miter runs `1 / cos(turn / 2)` nib widths into the shape, so a right angle
 * needs 1.41 and a 60° corner 2.0, while a 17° sliver would need 6.8 and spear a
 * spike deep into the ink. 4 is SVG's own default and lands between the two.
 */
const SNAP_MITER_LIMIT = 4;
/** A round join or cap turns at most this much per vertex of the drawn outline. */
const SNAP_ARC_STEP = (10 * Math.PI) / 180;

interface Vec2 {
	x: number;
	y: number;
}

/** Points along a circular arc about `centre`, from angle `from` sweeping `delta`. */
function arcPoints(centre: Vec2, radius: number, from: number, delta: number): Vec2[] {
	const steps = Math.max(1, Math.ceil(Math.abs(delta) / SNAP_ARC_STEP));
	const out: Vec2[] = [];
	for (let i = 0; i <= steps; i++) {
		const a = from + (delta * i) / steps;
		out.push({ x: centre.x + Math.cos(a) * radius, y: centre.y + Math.sin(a) * radius });
	}
	return out;
}

/**
 * Outline a snapped shape as a nib of constant half-width dragged along its
 * centreline — round on the outside of every corner, clean on the inside.
 *
 * This exists because perfect-freehand cannot draw the corner a snapped shape wants.
 * It emits one outline vertex per input sample, so a hard corner puts the entire turn
 * on a single vertex: the canvas joins outline vertices with straight lines, so that
 * draws as a point, one whose sharpness varies with the angle, and on sharp corners it
 * folded the band through itself and left a hole. Rounding the *centreline* instead
 * (v0.13.4) fixed those but made a corner's outer radius `fillet + nib` rather than
 * `nib`, so rectangles came out looking like rounded rectangles.
 *
 * A real round nib does neither. Swept round a corner it pivots about the vertex, so
 * the outside of the turn traces an arc of exactly the nib's radius — no more, no less,
 * and it scales with the brush the way every other part of the stroke does. Meanwhile
 * the inside of the turn is where the two edges of the band simply cross, which is a
 * sharp corner. That asymmetry is the whole look: crisp geometry, softened by the pen
 * rather than by the geometry.
 *
 * Snapped strokes are the only ones this suits, and it suits them exactly: their
 * pressure is constant by construction, so there is no width to vary and nothing
 * perfect-freehand was contributing. The ring it returns is the same shape of thing —
 * outside walked forward, inside walked back — so grain and both export paths are
 * unaffected.
 */
function snappedOutline(points: Point[], half: number): number[][] {
	// A zero-length step has no direction to offset along, so collapse repeats first.
	const p: Vec2[] = [];
	for (const q of points) {
		const last = p[p.length - 1];
		if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-6) {
			p.push({ x: q.x, y: q.y });
		}
	}
	// shapePoints closes a ring by repeating its first sample, which is the signal
	// that this is a loop with joins all the way round rather than two loose ends.
	let closed = false;
	if (p.length > 3) {
		const a = p[0];
		const b = p[p.length - 1];
		if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) {
			p.pop();
			closed = true;
		}
	}
	if (p.length === 0) return [];
	if (p.length === 1) {
		// A dot: the nib itself.
		return arcPoints(p[0], half, 0, Math.PI * 2).map((v) => [v.x, v.y]);
	}

	const n = p.length;
	const count = closed ? n : n - 1;
	// Unit direction and left-hand normal of each edge.
	const dir: Vec2[] = [];
	const nrm: Vec2[] = [];
	for (let i = 0; i < count; i++) {
		const a = p[i];
		const b = p[(i + 1) % n];
		const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
		dir.push(d);
		nrm.push({ x: -d.y, y: d.x });
	}

	const left: Vec2[] = [];
	const right: Vec2[] = [];
	const offset = (v: Vec2, nv: Vec2, sign: number): Vec2 => ({
		x: v.x + nv.x * half * sign,
		y: v.y + nv.y * half * sign,
	});

	for (let i = 0; i < n; i++) {
		const v = p[i];
		const inEdge = closed ? (i - 1 + count) % count : i - 1;
		const outEdge = closed ? i % count : i;
		if (!closed && i === 0) {
			left.push(offset(v, nrm[0], 1));
			right.push(offset(v, nrm[0], -1));
			continue;
		}
		if (!closed && i === n - 1) {
			left.push(offset(v, nrm[count - 1], 1));
			right.push(offset(v, nrm[count - 1], -1));
			continue;
		}

		const nIn = nrm[inEdge];
		const nOut = nrm[outEdge];
		// Which way the path turns decides which side is outside the corner.
		const cross = dir[inEdge].x * dir[outEdge].y - dir[inEdge].y * dir[outEdge].x;
		const dot = nIn.x * nOut.x + nIn.y * nOut.y;
		let turn = Math.atan2(cross, dir[inEdge].x * dir[outEdge].x + dir[inEdge].y * dir[outEdge].y);

		if (Math.abs(turn) < 1e-6) {
			// Straight through: one point per side, no join to build.
			left.push(offset(v, nOut, 1));
			right.push(offset(v, nOut, -1));
			continue;
		}

		// Outside of the turn: pivot about the vertex, so the arc's radius is the nib's.
		const outerSign = turn > 0 ? -1 : 1;
		const from = Math.atan2(nIn.y * outerSign, nIn.x * outerSign);
		const outer = arcPoints(v, half, from, turn);
		// Inside of the turn: where the two offset edges cross. Bevel it if that point
		// would sit further into the shape than the miter limit allows.
		const innerSign = -outerSign;
		const denom = 1 + dot;
		const inner: Vec2[] = [];
		if (denom > 1e-9 && 1 / Math.cos(Math.abs(turn) / 2) <= SNAP_MITER_LIMIT) {
			const mx = ((nIn.x + nOut.x) / denom) * half * innerSign;
			const my = ((nIn.y + nOut.y) / denom) * half * innerSign;
			inner.push({ x: v.x + mx, y: v.y + my });
		} else {
			inner.push(offset(v, nIn, innerSign), offset(v, nOut, innerSign));
		}

		if (outerSign === 1) {
			for (const q of outer) left.push(q);
			for (const q of inner) right.push(q);
		} else {
			for (const q of outer) right.push(q);
			for (const q of inner) left.push(q);
		}
	}

	const ring: Vec2[] = left.slice();
	if (closed) {
		/**
		 * A closed stroke is an annulus, and a single filled path can only describe one
		 * by walking its two boundaries in opposite directions and bridging between
		 * them. The bridge has to leave and re-enter at the *same* point, or it is not a
		 * bridge but a slab cut across the band: the first attempt here returned to the
		 * inner boundary at the last vertex instead of the first, and the winding flipped
		 * along the 33px between them, leaving a hole in the edge (134 sample points of
		 * bare canvas along a 200px square's top edge).
		 *
		 * So: round the outside, back to where the outside started, across to the inside,
		 * round the inside the other way, and back to where the inside started. Both
		 * crossings are then the same zero-area line, and it lands mid-edge because that
		 * is where polygonRing opens the ring.
		 */
		ring.push(left[0], right[0]);
		for (let i = right.length - 1; i >= 1; i--) ring.push(right[i]);
		ring.push(right[0]);
	} else {
		// Open: round the far end, back down the other side, round the near end.
		const end = p[n - 1];
		const endAngle = Math.atan2(nrm[count - 1].y, nrm[count - 1].x);
		for (const q of arcPoints(end, half, endAngle, -Math.PI)) ring.push(q);
		for (let i = right.length - 1; i >= 0; i--) ring.push(right[i]);
		const startAngle = Math.atan2(-nrm[0].y, -nrm[0].x);
		for (const q of arcPoints(p[0], half, startAngle, -Math.PI)) ring.push(q);
	}
	return ring.map((v) => [v.x, v.y]);
}

/**
 * Convert a stroke's points + pressure into a filled outline polygon using
 * perfect-freehand, so finger and Pencil strokes look naturally tapered.
 * Eraser strokes are not rendered (erasing removes strokes from the model).
 */
export function strokeToOutline(stroke: Stroke): number[][] {
	const inputPoints = stroke.points.map((pt) => [pt.x, pt.y, pt.p]);
	const opts = TOOL_STROKE_OPTIONS[stroke.tool] ?? TOOL_STROKE_OPTIONS.pen;
	const size = stroke.size * opts.weight;
	/**
	 * A snapped shape is outlined directly rather than through perfect-freehand. Its
	 * points are already exact and its pressure is constant, so there is no width to
	 * vary and nothing to smooth — smoothing only put the wobble back, and its corner
	 * handling was the source of every corner defect this feature has had. Grain still
	 * applies, so a snapped crayon is still recognisably a crayon.
	 */
	if (stroke.snapped) {
		return roughen(snappedOutline(stroke.points, size / 2), opts.grain * size);
	}
	const outline = getStroke(inputPoints, {
		size,
		thinning: opts.thinning,
		smoothing: opts.smoothing,
		streamline: opts.streamline,
		// Finger/mouse strokes have no real pressure; taper them from speed.
		simulatePressure: stroke.simulatePressure ?? false,
		start: { taper: opts.taper * size },
		end: { taper: opts.taper * size },
		last: true,
	});
	return roughen(outline, opts.grain * size);
}

/** Build an SVG path "d" string from an outline polygon. */
export function outlineToSvgPath(outline: number[][]): string {
	if (outline.length === 0) return "";
	const d = outline.reduce(
		(acc, [x0, y0], i, arr) => {
			const [x1, y1] = arr[(i + 1) % arr.length];
			acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
			return acc;
		},
		["M", outline[0][0], outline[0][1], "Q"] as (string | number)[],
	);
	d.push("Z");
	return d.join(" ");
}

/** Render an outline polygon onto a 2D canvas context as a filled shape. */
export function fillOutline(
	ctx: CanvasRenderingContext2D,
	outline: number[][],
): void {
	if (outline.length === 0) return;
	ctx.beginPath();
	ctx.moveTo(outline[0][0], outline[0][1]);
	for (let i = 1; i < outline.length; i++) {
		ctx.lineTo(outline[i][0], outline[i][1]);
	}
	ctx.closePath();
	ctx.fill();
}

/** Draw a whole document onto a canvas context (used by the editor & PNG export). */
export function renderDocToContext(
	ctx: CanvasRenderingContext2D,
	doc: SketchDoc,
): void {
	if (doc.background && doc.background !== "transparent") {
		ctx.fillStyle = doc.background;
		ctx.fillRect(0, 0, doc.width, doc.height);
	}
	for (const stroke of doc.strokes) {
		if (stroke.tool === "eraser") continue;
		const outline = strokeToOutline(stroke);
		ctx.globalAlpha = stroke.opacity;
		ctx.fillStyle = stroke.color;
		fillOutline(ctx, outline);
	}
	ctx.globalAlpha = 1;
}

/** Render a document to a PNG Blob at the given pixel scale. */
export async function renderDocToPngBlob(
	doc: SketchDoc,
	scale = 2,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(doc.width * scale));
	canvas.height = Math.max(1, Math.round(doc.height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not get 2D canvas context for export");
	ctx.scale(scale, scale);
	renderDocToContext(ctx, doc);
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error("Canvas toBlob returned null"));
		}, "image/png");
	});
}

/** Render a document to a standalone SVG string. */
export function renderDocToSvg(doc: SketchDoc): string {
	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">`,
	);
	if (doc.background && doc.background !== "transparent") {
		parts.push(
			`<rect width="${doc.width}" height="${doc.height}" fill="${doc.background}"/>`,
		);
	}
	for (const stroke of doc.strokes) {
		if (stroke.tool === "eraser") continue;
		const outline = strokeToOutline(stroke);
		const path = outlineToSvgPath(outline);
		if (!path) continue;
		parts.push(
			`<path d="${path}" fill="${stroke.color}" fill-opacity="${stroke.opacity}"/>`,
		);
	}
	parts.push("</svg>");
	return parts.join("");
}
