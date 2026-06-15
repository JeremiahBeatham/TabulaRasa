export const SKETCH_EXTENSION = "sketch";
export const SKETCH_DOC_VERSION = 1 as const;

export type ToolName = "pen" | "highlighter" | "eraser";

export interface Point {
	x: number;
	y: number;
	/** Pressure 0..1. Touch devices without real pressure report ~0.5. */
	p: number;
}

export interface Stroke {
	tool: ToolName;
	color: string;
	/** Base brush width in logical pixels. */
	size: number;
	/** 0..1 opacity (highlighter < 1). */
	opacity: number;
	/**
	 * When true, taper the stroke from drawing speed instead of real pressure.
	 * Set for finger/mouse input (no usable pressure) so lines look natural.
	 */
	simulatePressure?: boolean;
	points: Point[];
}

export interface SketchDoc {
	version: typeof SKETCH_DOC_VERSION;
	width: number;
	height: number;
	/** "transparent" or a CSS color string. */
	background: string;
	/**
	 * Vault path of the note this sketch was created from, if any. Used to
	 * default the "add to a note" target when exporting a PNG.
	 */
	sourceNote?: string;
	strokes: Stroke[];
}

export const DEFAULT_CANVAS_WIDTH = 1280;
export const DEFAULT_CANVAS_HEIGHT = 960;

export function createEmptyDoc(
	width = DEFAULT_CANVAS_WIDTH,
	height = DEFAULT_CANVAS_HEIGHT,
	background = "transparent",
): SketchDoc {
	return {
		version: SKETCH_DOC_VERSION,
		width,
		height,
		background,
		strokes: [],
	};
}

export function serializeDoc(doc: SketchDoc): string {
	return JSON.stringify(doc, null, 0);
}

/**
 * Parse a `.sketch` file body into a SketchDoc, tolerating empty/legacy files.
 * Always returns a valid document so the editor can recover gracefully.
 */
export function parseDoc(raw: string): SketchDoc {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) {
		return createEmptyDoc();
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return createEmptyDoc();
	}
	if (typeof parsed !== "object" || parsed === null) {
		return createEmptyDoc();
	}
	const obj = parsed as Partial<SketchDoc>;
	const doc = createEmptyDoc(
		typeof obj.width === "number" ? obj.width : DEFAULT_CANVAS_WIDTH,
		typeof obj.height === "number" ? obj.height : DEFAULT_CANVAS_HEIGHT,
		typeof obj.background === "string" ? obj.background : "transparent",
	);
	if (typeof obj.sourceNote === "string") {
		doc.sourceNote = obj.sourceNote;
	}
	if (Array.isArray(obj.strokes)) {
		doc.strokes = obj.strokes.filter(isValidStroke);
	}
	return doc;
}

function isValidStroke(value: unknown): value is Stroke {
	if (typeof value !== "object" || value === null) return false;
	const s = value as Partial<Stroke>;
	return (
		typeof s.color === "string" &&
		typeof s.size === "number" &&
		Array.isArray(s.points)
	);
}
