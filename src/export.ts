import { getStroke } from "perfect-freehand";
import { SketchDoc, Stroke, ToolName } from "./model";

interface ToolStrokeOptions {
	thinning: number;
	smoothing: number;
	streamline: number;
	/** Fraction of the brush size used to taper the stroke's ends. */
	taper: number;
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
const TOOL_STROKE_OPTIONS: Record<ToolName, ToolStrokeOptions> = {
	pen: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, taper: 0 },
	brush: { thinning: 0.86, smoothing: 0.62, streamline: 0.32, taper: 0.9 },
	highlighter: { thinning: 0.18, smoothing: 0.5, streamline: 0.55, taper: 0 },
	eraser: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, taper: 0 },
};

/**
 * Convert a stroke's points + pressure into a filled outline polygon using
 * perfect-freehand, so finger and Pencil strokes look naturally tapered.
 * Eraser strokes are not rendered (erasing removes strokes from the model).
 */
export function strokeToOutline(stroke: Stroke): number[][] {
	const inputPoints = stroke.points.map((pt) => [pt.x, pt.y, pt.p]);
	const opts = TOOL_STROKE_OPTIONS[stroke.tool] ?? TOOL_STROKE_OPTIONS.pen;
	const taper = opts.taper * stroke.size;
	return getStroke(inputPoints, {
		size: stroke.size,
		thinning: opts.thinning,
		smoothing: opts.smoothing,
		streamline: opts.streamline,
		// Finger/mouse strokes have no real pressure; taper them from speed.
		simulatePressure: stroke.simulatePressure ?? false,
		start: { taper },
		end: { taper },
		last: true,
	});
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
