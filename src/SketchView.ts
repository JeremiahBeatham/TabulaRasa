import {
	App,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TextFileView,
	TFile,
	WorkspaceLeaf,
	normalizePath,
	setIcon,
} from "obsidian";
import {
	SketchCanvas,
	BrushSettings,
	CanvasAnchor,
	EraserMode,
	MIN_CANVAS_SIZE,
	MAX_CANVAS_SIZE,
} from "./canvas";
import {
	SketchDoc,
	ToolName,
	createEmptyDoc,
	parseDoc,
	serializeDoc,
} from "./model";
import { renderDocToPngBlob, renderDocToSvg } from "./export";
import type { SelectionMode } from "./selection";
import type TabulaRasaPlugin from "./main";
import { TABULA_RASA_ICON_ID } from "./icon";

export const VIEW_TYPE_SKETCH = "tabula-rasa-sketch-view";

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 40;
// Largest first: the presets stack top-to-bottom beside the slider, whose fill
// rises from the bottom, so both read the same way — higher means bigger.
const SIZE_PRESETS = [40, 24, 12, 6, 2];

/** How long the name field waits for typing to stop before it renames the file. */
const RENAME_IDLE_MS = 1400;

/**
 * The tool list behind the brush button. The two erasers are the existing
 * eraserMode values promoted to first-class entries — previously you had to
 * know to re-tap the eraser to find them.
 */
interface ToolOption {
	id: string;
	tool: ToolName;
	eraserMode?: EraserMode;
	icon: string;
	label: string;
}

/**
 * Four tools, named plainly and with no descriptions — the list is a stack of
 * icons directly beneath the trigger, so the icon column lines up with the
 * button and the names read off to the right.
 *
 * Only the whole-stroke eraser is offered; partial/pixel erasing is still in
 * the engine but wasn't good enough to put in front of anyone.
 */
const TOOL_OPTIONS: ToolOption[] = [
	{ id: "pen", tool: "pen", icon: "pen", label: "Pen" },
	{ id: "crayon", tool: "crayon", icon: "pencil", label: "Crayon" },
	{ id: "marker", tool: "highlighter", icon: "highlighter", label: "Marker" },
	{
		id: "eraser",
		tool: "eraser",
		eraserMode: "stroke",
		icon: "eraser",
		label: "Eraser",
	},
	// Sits last because it isn't a brush: it draws a boundary instead of ink, and
	// neither size nor colour applies while it's active.
	{ id: "select", tool: "select", icon: "lasso-select", label: "Selection" },
];

/**
 * Icon names come from Lucide via Obsidian, and which ones a given Obsidian
 * version bundles isn't something we can check at build time. An unknown name
 * leaves the element empty — and in some versions throws, which would abandon the
 * rest of the bar half-built. So each attempt is guarded, and if neither name
 * resolves the button falls back to text: a wrong-looking button is a nuisance,
 * an invisible one is indistinguishable from a missing feature.
 */
function setIconSafe(
	el: HTMLElement,
	name: string,
	fallback: string,
	text = "•",
): void {
	const attempt = (candidate: string): boolean => {
		try {
			setIcon(el, candidate);
		} catch (e) {
			console.error(`Tabula Rasa: icon "${candidate}" failed`, e);
			return false;
		}
		return !!el.querySelector("svg");
	};
	if (attempt(name) || attempt(fallback)) return;
	el.setText(text);
}

/** The three ways a new boundary combines with the existing selection. */
const SELECTION_MODE_OPTIONS: {
	mode: SelectionMode;
	icon: string;
	fallback: string;
	label: string;
}[] = [
	{ mode: "replace", icon: "replace", fallback: "repeat", label: "Replace" },
	{ mode: "add", icon: "plus", fallback: "plus-circle", label: "Add to selection" },
	{
		mode: "subtract",
		icon: "minus",
		fallback: "minus-circle",
		label: "Remove from selection",
	},
];

/** Default for the rotate-by field, in degrees. */
const DEFAULT_ROTATE_DEGREES = 90;

/**
 * Which side of its trigger a popover opens on. The header buttons drop down;
 * the selection bar sits at the bottom of the screen, so its lists go up.
 */
type PopoverPlacement = "below" | "above";

/** Coerce a color to the `#rrggbb` form an <input type="color"> requires. */
function normalizeHex(color: string): string {
	const c = color.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(c)) return c;
	// Expand shorthand #rgb -> #rrggbb.
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	return "#000000";
}

/**
 * Full-screen editor for `.sketch` files. Extends TextFileView so Obsidian
 * handles file load/save and the dirty indicator; we serialize the SketchDoc
 * as the file's text content.
 */
export class SketchView extends TextFileView {
	private plugin: TabulaRasaPlugin;
	private doc: SketchDoc;
	private canvas: SketchCanvas | null = null;
	private canvasHost: HTMLElement | null = null;
	private brush: BrushSettings;
	private resizeObserver: ResizeObserver | null = null;

	// The four controls, added to Obsidian's view header via addAction().
	private toolBtn: HTMLElement | null = null;
	private sizeBtn: HTMLElement | null = null;
	private colorBtn: HTMLElement | null = null;
	/** Everything we put in the header, so it can be torn down and rebuilt. */
	private actionEls: HTMLElement[] = [];
	/** Obsidian's own first header action; ours are seated ahead of it. */
	private actionAnchor: HTMLElement | null = null;

	// Shared popover (tool list / brush size).
	private popover: HTMLElement | null = null;
	private popoverTrigger: HTMLElement | null = null;
	private closePopoverHandler: ((e: Event) => void) | null = null;

	// Brush-size popover state.
	private sizeTriggerDot: HTMLElement | null = null;
	private sizeSlider: HTMLElement | null = null;
	private sizeSliderFill: HTMLElement | null = null;
	private sizeSliderThumb: HTMLElement | null = null;
	private sizeValueLabel: HTMLElement | null = null;
	private sizePresetButtons = new Map<number, HTMLElement>();

	/** The visible colour swatch; tapping it summons the system colour sheet. */
	private colorInput: HTMLInputElement | null = null;

	/** The selection tool's controls. Present only while something is selected. */
	private selectBar: HTMLElement | null = null;
	private pasteBtn: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TabulaRasaPlugin) {
		super(leaf);
		this.plugin = plugin;
		const size = plugin.newCanvasSize();
		this.doc = createEmptyDoc(
			size.width,
			size.height,
			plugin.settings.defaultBackground,
		);
		this.brush = {
			tool: "pen",
			color: plugin.settings.defaultColor,
			size: plugin.settings.defaultBrushSize,
			opacity: 1,
			eraserMode: plugin.settings.eraserMode,
		};
	}

	getViewType(): string {
		return VIEW_TYPE_SKETCH;
	}

	getIcon(): string {
		return TABULA_RASA_ICON_ID;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "Sketch";
	}

	// --- TextFileView plumbing -----------------------------------------

	getViewData(): string {
		if (this.canvas) this.doc = this.canvas.getDoc();
		return serializeDoc(this.doc);
	}

	setViewData(data: string, clear: boolean): void {
		this.doc = parseDoc(data);
		if (clear) {
			// New file context: ensure canvas reflects this document.
			this.rebuildCanvas();
		} else if (this.canvas) {
			this.rebuildCanvas();
		}
	}

	clear(): void {
		const size = this.plugin.newCanvasSize();
		this.doc = createEmptyDoc(
			size.width,
			size.height,
			this.plugin.settings.defaultBackground,
		);
		if (this.canvas) this.rebuildCanvas();
	}

	// --- lifecycle ------------------------------------------------------

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("tabula-rasa-view");
		this.applyThemeDefaultColor();
		this.buildToolbar();
		this.canvasHost = this.contentEl.createDiv({
			cls: "tabula-rasa-canvas-host",
		});
		this.rebuildCanvas();

		this.resizeObserver = new ResizeObserver(() => this.canvas?.resize());
		if (this.canvasHost) this.resizeObserver.observe(this.canvasHost);
	}

	async onClose(): Promise<void> {
		this.closePopover();
		// The header belongs to Obsidian, so leave it as we found it.
		for (const el of this.actionEls) el.remove();
		this.actionEls = [];
		this.containerEl.removeClass("tabula-rasa-leaf");
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		// Persist the .sketch source so leaving/closing always keeps your work.
		if (this.file && this.canvas) {
			await this.app.vault
				.modify(this.file, this.getViewData())
				.catch((e) => console.error("Saving sketch on close failed", e));
		}
		this.canvas?.destroy();
		this.canvas = null;
	}

	// --- canvas wiring --------------------------------------------------

	private rebuildCanvas(): void {
		if (!this.canvasHost) return;
		this.canvas?.destroy();
		this.canvasHost.empty();
		this.canvas = new SketchCanvas(this.canvasHost, this.doc, this.brush, {
			palmRejection: this.plugin.settings.palmRejection,
			gestures: { enabled: this.plugin.settings.gesturesEnabled },
			onChange: () => this.requestSave(),
			onSelectionChange: () => this.syncSelectBar(),
		});
		this.syncSelectBar();
		// Defer sizing until layout settles (important on mobile open).
		window.setTimeout(() => this.canvas?.resize(), 0);
	}

	/** Rebuild the chrome after a settings change (button size, gestures). */
	refreshChrome(): void {
		this.closePopover();
		this.buildToolbar();
		this.rebuildCanvas();
	}

	/**
	 * Rename the sketch file. Obsidian's fileManager keeps links in other notes
	 * pointing at it, which a plain vault rename would not.
	 */
	private async renameSketch(name: string): Promise<void> {
		const file = this.file;
		const trimmed = name.trim();
		if (!file || !trimmed || trimmed === file.basename) return;
		if (/[\\/:]/.test(trimmed)) {
			new Notice("A sketch name can't contain \\ / or :");
			return;
		}
		const dir = file.parent && file.parent.path !== "/" ? file.parent.path : "";
		const target = normalizePath(
			`${dir ? dir + "/" : ""}${trimmed}.${file.extension}`,
		);
		if (this.app.vault.getAbstractFileByPath(target)) {
			new Notice(`“${trimmed}” already exists.`);
			return;
		}
		try {
			// No confirmation notice: the field is the confirmation, and a toast per
			// rename read as nagging while typing. Failures still speak up.
			await this.app.fileManager.renameFile(file, target);
		} catch (e) {
			console.error(e);
			new Notice("Rename failed. See console for details.");
		}
	}

	// --- toolbar --------------------------------------------------------

	/**
	 * Four controls — brush, size, colour, more — living in Obsidian's own view
	 * header next to its "..." menu, rather than in a bar of our own below it.
	 * That costs the sketch zero vertical space: the only chrome on screen is
	 * Obsidian's, which is the point. The filename is hidden to make room.
	 */
	private buildToolbar(): void {
		for (const el of this.actionEls) el.remove();
		this.actionEls = [];

		this.containerEl.addClass("tabula-rasa-leaf");
		this.containerEl.style.setProperty(
			"--tr-button-size",
			`${this.plugin.settings.toolbarButtonSize}px`,
		);

		const row = this.headerActions();

		this.toolBtn = this.makeAction(row, "pen", "Tool", (btn) =>
			this.togglePopover(btn, (pop) => this.buildToolPopover(pop)),
		);

		// The size button shows a dot scaled to the current brush, so the setting
		// is legible without opening anything.
		this.sizeBtn = this.makeAction(row, "", "Brush size", (btn) =>
			this.togglePopover(btn, (pop) => this.buildSizePopover(pop)),
		);
		this.sizeTriggerDot = this.sizeBtn.createDiv({ cls: "tabula-rasa-size-dot" });

		// The colour control is a real, visible <input type="color"> — restyled into
		// the swatch rather than hidden behind it. iOS opens the system Colors sheet
		// for a genuine tap on a genuine input; an invisible one, or one nested
		// inside a <button> (which is invalid HTML), is ignored. That's why the two
		// earlier attempts did nothing.
		this.colorBtn = row.createDiv({
			cls: "tabula-rasa-btn tabula-rasa-color-btn",
		});
		this.actionEls.push(this.colorBtn);
		// The input goes inside a circular clipping mask. WebKit gives colour inputs
		// their own intrinsic box and doesn't fully honour width/height, which is why
		// the swatch rendered as an oversized oval; masking makes the shape ours
		// regardless of what the platform does to the input itself.
		const swatch = this.colorBtn.createSpan({ cls: "tabula-rasa-color-swatch" });
		this.colorInput = swatch.createEl("input", {
			cls: "tabula-rasa-color-input",
			attr: { type: "color", "aria-label": "Colour" },
		});
		this.colorInput.value = normalizeHex(this.brush.color);
		this.colorInput.addEventListener("input", () =>
			this.selectColor(this.colorInput?.value ?? this.brush.color),
		);

		this.makeAction(row, "settings", "Sketch settings", () =>
			this.openMoreSheet(),
		);

		// createEl appends, which would land us to the right of Obsidian's "...".
		// Re-seat the row in order ahead of it so it reads
		// brush → size → colour → settings → Obsidian's own menu.
		if (this.actionAnchor && this.actionAnchor.parentElement === row) {
			for (const el of this.actionEls) {
				if (el.parentElement === row) row.insertBefore(el, this.actionAnchor);
			}
		}

		this.applyTool(this.currentToolOption());
		this.selectColor(this.brush.color);
		this.selectSize(this.brush.size);
	}

	/**
	 * Our controls go in the view header's action row, immediately left of
	 * Obsidian's own "..." (which can't be moved). We build the elements directly
	 * rather than via addAction() so their order is ours to set and so the colour
	 * control can be a plain div — addAction returns a <button>, and an <input>
	 * inside a <button> is invalid HTML that iOS won't activate.
	 */
	private headerActions(): HTMLElement {
		const existing = this.containerEl.querySelector<HTMLElement>(".view-actions");
		if (existing) {
			// Anchor before whatever Obsidian already put there, so ours sit to its
			// left and read brush → size → colour → settings.
			this.actionAnchor = existing.firstElementChild as HTMLElement | null;
			return existing;
		}
		// No header (unusual layouts): fall back to a strip above the canvas.
		this.actionAnchor = null;
		const fallback = this.contentEl.createDiv({ cls: "tabula-rasa-toolbar" });
		this.actionEls.push(fallback);
		return fallback;
	}

	private makeAction(
		row: HTMLElement,
		icon: string,
		label: string,
		onClick: (btn: HTMLElement) => void,
	): HTMLElement {
		const btn = row.createEl("button", {
			cls: "clickable-icon view-action tabula-rasa-btn",
			attr: { "aria-label": label, type: "button" },
		});
		if (icon) setIcon(btn, icon);
		btn.addEventListener("click", () => onClick(btn));
		this.actionEls.push(btn);
		return btn;
	}

	// --- tools ------------------------------------------------------------

	private currentToolOption(): ToolOption {
		const match = TOOL_OPTIONS.find(
			(o) =>
				o.tool === this.brush.tool &&
				(o.tool !== "eraser" || o.eraserMode === this.brush.eraserMode),
		);
		return match ?? TOOL_OPTIONS[0];
	}

	private buildToolPopover(pop: HTMLElement): void {
		pop.addClass("tabula-rasa-popover-stack");
		const activeId = this.currentToolOption().id;
		for (const option of TOOL_OPTIONS) {
			const row = pop.createEl("button", {
				cls: "tabula-rasa-tool-row",
				attr: { type: "button" },
			});
			row.toggleClass("is-active", option.id === activeId);
			const icon = row.createSpan({ cls: "tabula-rasa-tool-icon" });
			setIconSafe(icon, option.icon, "circle");
			row.createSpan({ cls: "tabula-rasa-tool-name", text: option.label });
			row.addEventListener("click", () => {
				this.applyTool(option);
				this.closePopover();
			});
		}
	}

	private applyTool(option: ToolOption): void {
		this.brush.tool = option.tool;
		// Highlighter lays down translucent ink; everything else is opaque.
		this.brush.opacity = option.tool === "highlighter" ? 0.4 : 1;
		if (option.eraserMode) {
			this.brush.eraserMode = option.eraserMode;
			this.plugin.settings.eraserMode = option.eraserMode;
			void this.plugin.saveSettings();
		}
		// setBrush drops any selection when the tool changes away from select, so
		// the bar has to be re-synced after it, not before.
		this.canvas?.setBrush(this.brush);
		if (this.toolBtn) {
			setIconSafe(this.toolBtn, option.icon, "circle");
			this.toolBtn.setAttribute("aria-label", option.label);
		}
		this.updateInkControls();
		this.syncSelectBar();
	}

	/**
	 * Size and colour don't apply to the selection tool, so they're dimmed and
	 * inert while it's active rather than silently doing nothing — a control that
	 * ignores a tap reads as broken.
	 */
	private updateInkControls(): void {
		const inks = this.brush.tool !== "select";
		for (const el of [this.sizeBtn, this.colorBtn]) {
			if (!el) continue;
			el.toggleClass("is-disabled", !inks);
			if (el instanceof HTMLButtonElement) el.disabled = !inks;
		}
		if (this.colorInput) this.colorInput.disabled = !inks;
		if (!inks && this.popoverTrigger === this.sizeBtn) this.closePopover();
	}

	// --- color ----------------------------------------------------------

	private selectColor(color: string): void {
		this.brush.color = color;
		this.canvas?.setBrush(this.brush);
		this.updateColorUI();
	}

	/** The colour button is a wheel with the current colour in its centre. */
	private updateColorUI(): void {
		const color = this.brush.color;
		this.colorBtn?.style.setProperty("--tr-current-color", color);
		if (this.colorInput) {
			const hex = normalizeHex(color);
			if (this.colorInput.value !== hex) this.colorInput.value = hex;
		}
	}

	// --- selection controls ---------------------------------------------

	/**
	 * The selection's own bar, along the bottom of the canvas. It exists only while
	 * something is selected — there is nothing for it to act on otherwise — and it
	 * floats over the canvas rather than taking a row of its own, so appearing and
	 * disappearing never resizes the drawing surface mid-edit.
	 *
	 * Its dropdowns open *upward*, since it sits at the bottom of the screen.
	 */
	private syncSelectBar(): void {
		const wanted =
			this.brush.tool === "select" && (this.canvas?.hasSelection() ?? false);
		if (!wanted) {
			if (this.selectBar) {
				if (this.popoverTrigger && this.selectBar.contains(this.popoverTrigger)) {
					this.closePopover();
				}
				this.selectBar.remove();
			}
			this.selectBar = null;
			this.pasteBtn = null;
			return;
		}
		if (!this.selectBar) this.buildSelectBar();
		this.updatePasteState();
	}

	private buildSelectBar(): void {
		const bar = this.contentEl.createDiv({ cls: "tabula-rasa-select-bar" });
		this.selectBar = bar;

		// How the next boundary combines with this one.
		const modeBtn = this.makeBarButton(
			bar,
			"arrow-left-right",
			"repeat",
			"Selection mode",
		);
		modeBtn.addEventListener("click", () =>
			this.togglePopover(modeBtn, (pop) => this.buildModePopover(pop), "above"),
		);

		const transformBtn = this.makeBarButton(
			bar,
			"scaling",
			"move",
			"Transform selection",
		);
		transformBtn.addEventListener("click", () =>
			this.togglePopover(
				transformBtn,
				(pop) => this.buildTransformPopover(pop),
				"above",
			),
		);

		const copyBtn = this.makeBarButton(bar, "copy", "files", "Copy selection");
		copyBtn.addEventListener("click", () => {
			const strokes = this.canvas?.copySelection();
			if (!strokes) return;
			this.plugin.selectionClipboard = strokes;
			// Paste lighting up is the feedback; a notice on every copy would nag.
			this.updatePasteState();
		});

		this.pasteBtn = this.makeBarButton(
			bar,
			"clipboard-paste",
			"clipboard",
			"Paste selection",
		);
		this.pasteBtn.addEventListener("click", () => {
			const strokes = this.plugin.selectionClipboard;
			if (strokes) this.canvas?.pasteStrokes(strokes);
		});

		// Delete and clear are deliberately both here and adjacent: one takes the ink,
		// the other only puts the box away, and the bar is the only way to do either.
		const deleteBtn = this.makeBarButton(
			bar,
			"trash-2",
			"trash",
			"Delete selection",
		);
		deleteBtn.addEventListener("click", () => this.canvas?.deleteSelection());

		const clearBtn = this.makeBarButton(bar, "x", "cross", "Clear selection");
		clearBtn.addEventListener("click", () => this.canvas?.clearSelection());
	}

	private makeBarButton(
		bar: HTMLElement,
		icon: string,
		fallback: string,
		label: string,
		text?: string,
	): HTMLButtonElement {
		const btn = bar.createEl("button", {
			cls: "clickable-icon tabula-rasa-btn tabula-rasa-bar-btn",
			attr: { "aria-label": label, type: "button" },
		});
		setIconSafe(btn, icon, fallback, text ?? label.slice(0, 1));
		return btn;
	}

	private updatePasteState(): void {
		const has = this.plugin.selectionClipboard !== null;
		if (!this.pasteBtn) return;
		this.pasteBtn.toggleClass("is-disabled", !has);
		if (this.pasteBtn instanceof HTMLButtonElement) {
			this.pasteBtn.disabled = !has;
		}
	}

	private buildModePopover(pop: HTMLElement): void {
		pop.addClass("tabula-rasa-popover-stack");
		const current = this.canvas?.getSelectionMode() ?? "replace";
		for (const option of SELECTION_MODE_OPTIONS) {
			const row = pop.createEl("button", {
				cls: "tabula-rasa-tool-row",
				attr: { type: "button" },
			});
			row.toggleClass("is-active", option.mode === current);
			const icon = row.createSpan({ cls: "tabula-rasa-tool-icon" });
			setIconSafe(icon, option.icon, option.fallback);
			row.createSpan({ cls: "tabula-rasa-tool-name", text: option.label });
			row.addEventListener("click", () => {
				this.canvas?.setSelectionMode(option.mode);
				this.closePopover();
			});
		}
	}

	private buildTransformPopover(pop: HTMLElement): void {
		pop.addClass("tabula-rasa-popover-stack");

		const action = (
			icon: string,
			fallback: string,
			label: string,
			run: () => void,
		): void => {
			const row = pop.createEl("button", {
				cls: "tabula-rasa-tool-row",
				attr: { type: "button" },
			});
			const ic = row.createSpan({ cls: "tabula-rasa-tool-icon" });
			setIconSafe(ic, icon, fallback);
			row.createSpan({ cls: "tabula-rasa-tool-name", text: label });
			row.addEventListener("click", () => {
				run();
				this.closePopover();
			});
		};

		action("flip-horizontal", "move-horizontal", "Flip horizontal", () =>
			this.canvas?.flipSelection("horizontal"),
		);
		action("flip-vertical", "move-vertical", "Flip vertical", () =>
			this.canvas?.flipSelection("vertical"),
		);

		// A div, not a button: an <input> inside a <button> is invalid HTML, and iOS
		// won't reliably focus one that is.
		const row = pop.createDiv({ cls: "tabula-rasa-tool-row tabula-rasa-rotate-row" });
		const ic = row.createSpan({ cls: "tabula-rasa-tool-icon" });
		setIconSafe(ic, "rotate-cw", "refresh-cw");
		row.createSpan({ cls: "tabula-rasa-tool-name", text: "Rotate" });
		const input = row.createEl("input", {
			cls: "tabula-rasa-rotate-input",
			attr: {
				type: "number",
				step: "1",
				"aria-label": "Rotate selection by degrees",
			},
		});
		input.value = String(DEFAULT_ROTATE_DEGREES);
		row.createSpan({ cls: "tabula-rasa-rotate-unit", text: "°" });
		const apply = (): void => {
			const n = Number(input.value);
			if (Number.isFinite(n)) this.canvas?.rotateSelection(n);
			this.closePopover();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				apply();
			}
		});
		// Tapping the label rotates by whatever is in the field, so the row works
		// without a keyboard round-trip for the common 90°.
		ic.addEventListener("click", apply);
	}

	// --- shared popover -------------------------------------------------

	private togglePopover(
		trigger: HTMLElement,
		build: (pop: HTMLElement) => void,
		placement: PopoverPlacement = "below",
	): void {
		if (this.popover && this.popoverTrigger === trigger) this.closePopover();
		else this.openPopover(trigger, build, placement);
	}

	private openPopover(
		trigger: HTMLElement,
		build: (pop: HTMLElement) => void,
		placement: PopoverPlacement = "below",
	): void {
		this.closePopover();
		// Hosted on the leaf, not contentEl: the triggers live in the view header,
		// which sits above contentEl, so anchoring to contentEl would place the
		// popover off the top of the canvas.
		const pop = this.containerEl.createDiv({ cls: "tabula-rasa-popover" });
		this.popover = pop;
		this.popoverTrigger = trigger;
		build(pop);
		this.positionPopover(pop, trigger, placement);

		// Dismiss on outside interaction or Escape.
		this.closePopoverHandler = (e: Event) => {
			if (e instanceof KeyboardEvent) {
				if (e.key === "Escape") this.closePopover();
				return;
			}
			const target = e.target as Node;
			if (pop.contains(target) || trigger.contains(target)) return;
			this.closePopover();
		};
		document.addEventListener("pointerdown", this.closePopoverHandler, true);
		document.addEventListener("keydown", this.closePopoverHandler, true);
	}

	private positionPopover(
		pop: HTMLElement,
		trigger: HTMLElement,
		placement: PopoverPlacement,
	): void {
		const host = this.containerEl.getBoundingClientRect();
		const tr = trigger.getBoundingClientRect();
		// Measured after build(), so offsetHeight is the real height.
		pop.style.top =
			placement === "above"
				? `${Math.max(8, tr.top - host.top - pop.offsetHeight - 6)}px`
				: `${tr.bottom - host.top + 6}px`;
		const maxLeft = Math.max(8, host.width - pop.offsetWidth - 8);
		const left = Math.min(Math.max(8, tr.left - host.left), maxLeft);
		pop.style.left = `${left}px`;
	}

	private closePopover(): void {
		if (this.closePopoverHandler) {
			document.removeEventListener(
				"pointerdown",
				this.closePopoverHandler,
				true,
			);
			document.removeEventListener(
				"keydown",
				this.closePopoverHandler,
				true,
			);
			this.closePopoverHandler = null;
		}
		this.popover?.remove();
		this.popover = null;
		this.popoverTrigger = null;
		this.sizeSlider = null;
		this.sizeSliderFill = null;
		this.sizeSliderThumb = null;
		this.sizeValueLabel = null;
		this.sizePresetButtons.clear();
		// colorInput deliberately survives: it lives on the toolbar, not in here.
	}

	// --- brush size -----------------------------------------------------

	private buildSizePopover(pop: HTMLElement): void {
		pop.addClass("tabula-rasa-popover-stack");

		// Presets stack under the button; the slider stands vertically beside them.
		// A horizontal slider is unusable here — dragging one sideways is read as
		// Obsidian's back-swipe and throws you out to file navigation.
		const row = pop.createDiv({ cls: "tabula-rasa-size-row" });

		const presets = row.createDiv({ cls: "tabula-rasa-size-presets" });
		this.sizePresetButtons.clear();
		for (const size of SIZE_PRESETS) {
			const b = presets.createEl("button", {
				cls: "tabula-rasa-size",
				attr: { "aria-label": `Size ${size}`, type: "button" },
			});
			const dot = b.createDiv({ cls: "tabula-rasa-size-dot" });
			const px = Math.max(4, Math.min(22, size));
			dot.style.width = `${px}px`;
			dot.style.height = `${px}px`;
			b.addEventListener("click", () => this.selectSize(size));
			this.sizePresetButtons.set(size, b);
		}

		this.buildVerticalSlider(row);

		// The readout doubles as the way in to typing an exact value.
		this.sizeValueLabel = pop.createEl("button", {
			cls: "tabula-rasa-size-value",
			attr: { type: "button", "aria-label": "Edit brush size" },
		});
		this.sizeValueLabel.addEventListener("click", () => this.editSizeValue());

		this.updateSizeUI();
	}

	/**
	 * A hand-built vertical slider rather than <input type="range">. The native
	 * one renders wildly differently per engine — in Obsidian's webview
	 * `appearance: slider-vertical` came out as a ~96px grey block with no visible
	 * track — and its value axis inverts depending on writing-mode. Owning the
	 * geometry is less code than fighting that, and drag stays on pointer events
	 * so `touch-action: none` reliably keeps it away from Obsidian's back-swipe.
	 */
	private buildVerticalSlider(parent: HTMLElement): void {
		const track = parent.createDiv({ cls: "tabula-rasa-vslider" });
		track.setAttribute("role", "slider");
		track.setAttribute("aria-orientation", "vertical");
		track.setAttribute("aria-valuemin", String(MIN_BRUSH_SIZE));
		track.setAttribute("aria-valuemax", String(MAX_BRUSH_SIZE));
		track.setAttribute("aria-label", "Brush size");
		track.tabIndex = 0;
		const fill = track.createDiv({ cls: "tabula-rasa-vslider-fill" });
		const thumb = track.createDiv({ cls: "tabula-rasa-vslider-thumb" });
		this.sizeSlider = track;
		this.sizeSliderFill = fill;
		this.sizeSliderThumb = thumb;

		// Bottom of the track is the smallest size, so up means bigger.
		const valueFromY = (clientY: number): number => {
			const r = track.getBoundingClientRect();
			if (r.height <= 0) return this.brush.size;
			const t = 1 - (clientY - r.top) / r.height;
			const raw =
				MIN_BRUSH_SIZE + t * (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
			return Math.round(raw);
		};

		let dragging = false;
		track.addEventListener("pointerdown", (evt) => {
			dragging = true;
			track.setPointerCapture(evt.pointerId);
			this.selectSize(valueFromY(evt.clientY));
			evt.preventDefault();
		});
		track.addEventListener("pointermove", (evt) => {
			if (!dragging) return;
			this.selectSize(valueFromY(evt.clientY));
			evt.preventDefault();
		});
		const end = (): void => {
			dragging = false;
		};
		track.addEventListener("pointerup", end);
		track.addEventListener("pointercancel", end);

		track.addEventListener("keydown", (evt) => {
			if (evt.key === "ArrowUp" || evt.key === "ArrowRight") {
				this.selectSize(this.brush.size + 1);
			} else if (evt.key === "ArrowDown" || evt.key === "ArrowLeft") {
				this.selectSize(this.brush.size - 1);
			} else {
				return;
			}
			evt.preventDefault();
		});
	}

	/** Swap the pixel readout for a number field so an exact size can be typed. */
	private editSizeValue(): void {
		const label = this.sizeValueLabel;
		if (!label || !label.parentElement) return;
		const input = label.parentElement.createEl("input", {
			cls: "tabula-rasa-size-input",
			attr: {
				type: "number",
				min: String(MIN_BRUSH_SIZE),
				max: String(MAX_BRUSH_SIZE),
				"aria-label": "Brush size in pixels",
			},
		});
		label.parentElement.insertBefore(input, label);
		label.hide();
		input.value = String(this.brush.size);
		input.focus();
		input.select();

		const commit = (): void => {
			const n = Number(input.value);
			if (Number.isFinite(n)) this.selectSize(n);
			input.remove();
			label.show();
			this.updateSizeUI();
		};
		input.addEventListener("blur", commit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") commit();
			else if (e.key === "Escape") {
				input.remove();
				label.show();
			}
		});
	}

	private selectSize(size: number): void {
		const clamped = Math.max(
			MIN_BRUSH_SIZE,
			Math.min(MAX_BRUSH_SIZE, Math.round(size)),
		);
		this.brush.size = clamped;
		this.canvas?.setBrush(this.brush);
		this.updateSizeUI();
	}

	/** Reflect the current size on the trigger dot and (if open) the popover. */
	private updateSizeUI(): void {
		const size = this.brush.size;
		if (this.sizeTriggerDot) {
			const px = Math.max(4, Math.min(22, size));
			this.sizeTriggerDot.style.width = `${px}px`;
			this.sizeTriggerDot.style.height = `${px}px`;
		}
		// Fraction of the way up the track, so 0% sits at the bottom.
		const t =
			(size - MIN_BRUSH_SIZE) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE);
		const pct = `${Math.round(t * 100)}%`;
		if (this.sizeSlider) {
			this.sizeSlider.setAttribute("aria-valuenow", String(size));
		}
		if (this.sizeSliderFill) this.sizeSliderFill.style.height = pct;
		if (this.sizeSliderThumb) this.sizeSliderThumb.style.bottom = pct;
		this.sizeValueLabel?.setText(`${size} px`);
		this.sizePresetButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === size),
		);
	}

	/**
	 * Everything that isn't drawing. Undo and redo appear here as well as on the
	 * three-finger gestures — a gesture with no visible affordance is invisible
	 * to anyone who hasn't been told about it.
	 */
	/**
	 * Everything that isn't drawing. Section order and contents come from the card
	 * sort in docs/tools/settings-card-sort.html, not from how the code is laid out.
	 */
	private openMoreSheet(): void {
		const doc = this.canvas?.getDoc();
		new MoreSheet(this.app, {
			name: this.file?.basename ?? "",
			background: doc?.background ?? "transparent",
			width: doc?.width ?? this.plugin.settings.canvasWidth,
			height: doc?.height ?? this.plugin.settings.canvasHeight,
			hasContent: (doc?.strokes.length ?? 0) > 0,
			palmRejection: this.plugin.settings.palmRejection,
			canUndo: this.canvas?.canUndo() ?? false,
			canRedo: this.canvas?.canRedo() ?? false,
			onRename: (name) => void this.renameSketch(name),
			onUndo: () => this.canvas?.undo(),
			onRedo: () => this.canvas?.redo(),
			onClear: () => this.canvas?.clear(),
			onPalmRejection: (enabled) => {
				this.plugin.settings.palmRejection = enabled;
				void this.plugin.saveSettings();
				// Applied live, so the current zoom/pan/rotation survives the change.
				this.canvas?.setPalmRejection(enabled);
			},
			onFit: () => this.canvas?.fitView(),
			onBackground: (value) => {
				this.canvas?.setBackground(value);
				this.requestSave();
			},
			onResize: (w, h, anchor, scaleToFit) =>
				this.canvas?.resizeCanvas(w, h, anchor, scaleToFit),
			onFitToContent: () => this.canvas?.fitCanvasToContent(),
			onEmbedPng: () => void this.exportAndEmbed(),
			onShare: (format) => void this.shareSketch(format),
		}).open();
	}

	/** Pick a starting pen color that's visible on the current theme background. */
	private applyThemeDefaultColor(): void {
		if (!this.plugin.settings.matchPenColorToTheme) return;
		const isDark = document.body.classList.contains("theme-dark");
		this.brush.color = isDark ? "#ffffff" : "#000000";
	}

	/** Write the .sketch source now. No PNG is produced — that's export-only. */
	private async saveSketch(): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to save yet.");
			return;
		}
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			new Notice("Sketch saved.");
		} catch (e) {
			console.error(e);
			new Notice("Save failed. See console for details.");
		}
	}

	/**
	 * Hand the rendered sketch to the system share sheet, which is what lets it
	 * reach Files or Photos without us writing anything into the vault. iOS filters
	 * the sheet's actions by file type, so a PNG offers "Save Image" as well as
	 * "Save to Files" while an SVG only offers the latter.
	 *
	 * Web Share with files isn't guaranteed inside Obsidian's webview, so when it
	 * isn't available we save into the vault instead and say so rather than
	 * silently doing nothing.
	 */
	private async shareSketch(format: "png" | "svg"): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to share yet.");
			return;
		}
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			const doc = parseDoc(this.getViewData());
			const base = this.file.basename;
			const file =
				format === "svg"
					? new File([renderDocToSvg(doc)], `${base}.svg`, {
							type: "image/svg+xml",
						})
					: new File(
							[
								await renderDocToPngBlob(
									doc,
									this.plugin.settings.pngExportScale,
								),
							],
							`${base}.png`,
							{ type: "image/png" },
						);

			const nav = navigator as Navigator & {
				canShare?: (data: { files: File[] }) => boolean;
				share?: (data: { files: File[]; title?: string }) => Promise<void>;
			};
			if (nav.share && nav.canShare?.({ files: [file] })) {
				await nav.share({ files: [file], title: base });
				return;
			}

			// No share sheet here — fall back to the vault so the export isn't lost.
			if (format === "svg") {
				await this.plugin.exportActiveSvg(this);
			} else {
				await this.exportToFile();
			}
			new Notice(
				"Sharing isn't available here, so the file was saved to your vault instead.",
			);
		} catch (e) {
			// An aborted share sheet rejects; that's a normal cancel, not a failure.
			if (e instanceof Error && e.name === "AbortError") return;
			console.error(e);
			new Notice("Share failed. See console for details.");
		}
	}

	private async exportToFile(): Promise<void> {
		if (!this.file) return;
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			const path = await this.plugin.exportSketchToPng(
				this.file,
				this.getViewData(),
			);
			new Notice(`Image saved to your vault: ${path}`);
		} catch (e) {
			console.error(e);
			new Notice("PNG export failed. See console for details.");
		}
	}

	private async exportAndEmbed(): Promise<void> {
		if (!this.file) return;
		const note = await this.resolveTargetNote();
		if (!note) return;
		try {
			await this.app.vault.modify(this.file, this.getViewData());
			const pngPath = await this.plugin.exportSketchToPng(
				this.file,
				this.getViewData(),
			);
			await this.embedInNote(note, pngPath);
			// Remember the note for next time if the sketch had none.
			if (this.canvas && !this.canvas.getDoc().sourceNote) {
				this.canvas.getDoc().sourceNote = note.path;
				await this.app.vault.modify(this.file, this.getViewData());
			}
			new Notice(`Image added to “${note.basename}”.`);
		} catch (e) {
			console.error(e);
			new Notice("Export failed. See console for details.");
		}
	}

	/** Use the sketch's origin note if it still exists, otherwise let the user pick. */
	private resolveTargetNote(): Promise<TFile | null> {
		const sourcePath = this.canvas?.getDoc().sourceNote;
		if (sourcePath) {
			const f = this.app.vault.getAbstractFileByPath(sourcePath);
			if (f instanceof TFile && f.extension === "md") {
				return Promise.resolve(f);
			}
		}
		return new Promise((resolve) => {
			new NotePickerModal(this.app, resolve).open();
		});
	}

	/** Insert the embed after the sketch's link if present, else append it. */
	private async embedInNote(note: TFile, pngPath: string): Promise<void> {
		const pngName = pngPath.split("/").pop() ?? pngPath;
		const embed = `![[${pngName}]]`;
		const content = await this.app.vault.read(note);
		if (content.includes(embed)) return; // already embedded

		const sketchName = this.file?.basename ?? "";
		const lines = content.split("\n");
		const linkIdx = sketchName
			? lines.findIndex((l) => l.includes(`[[${sketchName}`))
			: -1;
		if (linkIdx >= 0) {
			lines.splice(linkIdx + 1, 0, embed);
			await this.app.vault.modify(note, lines.join("\n"));
		} else {
			const sep = content.endsWith("\n") || content === "" ? "" : "\n";
			await this.app.vault.modify(note, `${content}${sep}\n${embed}\n`);
		}
	}
}

interface MoreSheetActions {
	name: string;
	background: string;
	width: number;
	height: number;
	hasContent: boolean;
	palmRejection: boolean;
	canUndo: boolean;
	canRedo: boolean;
	onRename: (name: string) => void;
	onUndo: () => void;
	onRedo: () => void;
	onClear: () => void;
	onPalmRejection: (enabled: boolean) => void;
	onFit: () => void;
	onBackground: (value: string) => void;
	onResize: (
		width: number,
		height: number,
		anchor: CanvasAnchor,
		scaleToFit: boolean,
	) => void;
	onFitToContent: () => void;
	onEmbedPng: () => void;
	onShare: (format: "png" | "svg") => void;
}

const RESIZE_PRESETS: { label: string; width: number; height: number }[] = [
	{ label: "Square", width: 1280, height: 1280 },
	{ label: "4:3", width: 1280, height: 960 },
	{ label: "16:9", width: 1280, height: 720 },
	{ label: "A4 portrait", width: 1240, height: 1754 },
	{ label: "A4 landscape", width: 1754, height: 1240 },
];

const ANCHOR_OPTIONS: { value: CanvasAnchor; label: string }[] = [
	{ value: "top-left", label: "Top left" },
	{ value: "top", label: "Top" },
	{ value: "top-right", label: "Top right" },
	{ value: "left", label: "Left" },
	{ value: "center", label: "Center" },
	{ value: "right", label: "Right" },
	{ value: "bottom-left", label: "Bottom left" },
	{ value: "bottom", label: "Bottom" },
	{ value: "bottom-right", label: "Bottom right" },
];

/**
 * The per-sketch settings sheet. Sections and their order come from a card sort
 * rather than from how the code happened to be organised, which is why the canvas
 * resize controls and the two PNG destinations appear inline here: they used to be
 * buried in their own modals, and the sort promoted them out.
 */
class MoreSheet extends Modal {
	private width: number;
	private height: number;
	private anchor: CanvasAnchor = "center";
	private format: "png" | "svg" = "png";
	private widthInput: HTMLInputElement | null = null;
	private heightInput: HTMLInputElement | null = null;

	constructor(
		app: App,
		private actions: MoreSheetActions,
	) {
		super(app);
		this.width = actions.width;
		this.height = actions.height;
	}

	/**
	 * Section headings carry an icon and are set larger than the option titles
	 * beneath them. Obsidian's own setHeading() renders at roughly the same weight
	 * as a setting name, which left sections losing to their own contents.
	 */
	private heading(icon: string, text: string): void {
		const h = this.contentEl.createDiv({ cls: "tabula-rasa-sheet-heading" });
		const ic = h.createSpan({ cls: "tabula-rasa-sheet-heading-icon" });
		setIcon(ic, icon);
		h.createSpan({ cls: "tabula-rasa-sheet-heading-text", text });
	}

	onOpen(): void {
		this.modalEl.addClass("tabula-rasa-sheet");
		this.contentEl.addClass("tabula-rasa-sheet-body");
		this.titleEl.setText("Sketch");

		this.buildSketch();
		this.buildCanvas();
		this.buildExport();
	}

	// --- Sketch ---------------------------------------------------------

	private buildSketch(): void {
		this.heading("file-pen", "Sketch");

		// No confirm button: the field commits once you've stopped typing, or at once
		// on blur/Enter. The wait is deliberately long — at 700ms an ordinary pause
		// mid-word renamed the file and toasted about it, so one name could rename
		// several times on the way to being finished.
		new Setting(this.contentEl)
			.setName("Name")
			.setDesc("Saves as you type. Links to this sketch in your notes follow it.")
			.addText((t) => {
				t.setValue(this.actions.name);
				let timer: number | null = null;
				const commit = (): void => {
					if (timer !== null) {
						window.clearTimeout(timer);
						timer = null;
					}
					this.actions.onRename(t.inputEl.value);
				};
				t.onChange(() => {
					if (timer !== null) window.clearTimeout(timer);
					timer = window.setTimeout(commit, RENAME_IDLE_MS);
				});
				t.inputEl.addEventListener("blur", commit);
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				});
			});

		new Setting(this.contentEl)
			.setName("Undo and redo")
			.setDesc("Or double-tap the canvas: two fingers to undo, three to redo.")
			.addButton((b) =>
				b
					.setButtonText("Undo")
					.setDisabled(!this.actions.canUndo)
					.onClick(() => {
						this.close();
						this.actions.onUndo();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText("Redo")
					.setDisabled(!this.actions.canRedo)
					.onClick(() => {
						this.close();
						this.actions.onRedo();
					}),
			);

		new Setting(this.contentEl)
			.setName("Clear sketch")
			.setDesc("Remove every stroke. This can be undone.")
			.addButton((b) =>
				b
					.setButtonText("Clear")
					.setWarning()
					.onClick(() => {
						this.close();
						this.actions.onClear();
					}),
			);

		// Lives here rather than in the plugin settings because it's something you
		// reach for mid-sketch when you swap between a finger and the Pencil.
		new Setting(this.contentEl)
			.setName("Palm rejection")
			.setDesc("Ignore finger input while an Apple Pencil or stylus is drawing.")
			.addToggle((t) =>
				t
					.setValue(this.actions.palmRejection)
					.onChange((v) => this.actions.onPalmRejection(v)),
			);
	}

	// --- Canvas ---------------------------------------------------------

	private buildCanvas(): void {
		this.heading("frame", "Canvas");

		new Setting(this.contentEl)
			.setName("Fit to screen")
			.setDesc("Reset zoom, pan and rotation.")
			.addButton((b) =>
				b.setButtonText("Fit").onClick(() => {
					this.close();
					this.actions.onFit();
				}),
			);

		new Setting(this.contentEl)
			.setName("Fit to drawing")
			.setDesc(
				this.actions.hasContent
					? "Shrink the page to tightly wrap your strokes."
					: "Draw something first to use this.",
			)
			.addButton((b) => {
				b.setButtonText("Fit");
				b.setDisabled(!this.actions.hasContent);
				b.onClick(() => {
					this.close();
					this.actions.onFitToContent();
				});
			});

		new Setting(this.contentEl)
			.setName("Custom size")
			.setDesc(`Width and height in pixels, ${MIN_CANVAS_SIZE}–${MAX_CANVAS_SIZE}.`)
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.setAttribute("aria-label", "Width");
				t.setValue(String(this.width));
				this.widthInput = t.inputEl;
				t.onChange((v) => {
					this.width = Number(v);
				});
			})
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.setAttribute("aria-label", "Height");
				t.setValue(String(this.height));
				this.heightInput = t.inputEl;
				t.onChange((v) => {
					this.height = Number(v);
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Apply")
					.setCta()
					.onClick(() => this.applySize()),
			);

		const presets = new Setting(this.contentEl)
			.setName("Aspect ratio")
			.setDesc("Applies immediately, using the anchor below.");
		for (const p of RESIZE_PRESETS) {
			presets.addButton((b) =>
				b.setButtonText(p.label).onClick(() => {
					this.width = p.width;
					this.height = p.height;
					this.syncInputs();
					this.applySize();
				}),
			);
		}

		// A real colour picker: on iOS this input raises the system Colors sheet,
		// the same one the toolbar's colour button uses.
		const colourSetting = new Setting(this.contentEl)
			.setName("Canvas colour")
			.setDesc("Transparent takes the colour of whatever the sketch sits on.");
		colourSetting.addButton((b) =>
			b.setButtonText("Transparent").onClick(() => {
				this.actions.onBackground("transparent");
				new Notice("Canvas set to transparent.");
			}),
		);
		const swatch = colourSetting.controlEl.createEl("input", {
			cls: "tabula-rasa-page-colour",
			attr: { type: "color", "aria-label": "Canvas colour" },
		});
		swatch.value = normalizeHex(
			this.actions.background === "transparent"
				? "#1e1e1e"
				: this.actions.background,
		);
		swatch.addEventListener("input", () =>
			this.actions.onBackground(swatch.value),
		);

		new Setting(this.contentEl)
			.setName("Anchor")
			.setDesc("Where your drawing stays when the page size changes.")
			.addDropdown((dd) => {
				for (const a of ANCHOR_OPTIONS) dd.addOption(a.value, a.label);
				dd.setValue(this.anchor);
				dd.onChange((v) => {
					this.anchor = v as CanvasAnchor;
				});
			});
	}

	private syncInputs(): void {
		if (this.widthInput) this.widthInput.value = String(this.width);
		if (this.heightInput) this.heightInput.value = String(this.height);
	}

	private applySize(): void {
		const w = Math.round(this.width);
		const h = Math.round(this.height);
		if (
			!Number.isFinite(w) ||
			!Number.isFinite(h) ||
			w < MIN_CANVAS_SIZE ||
			h < MIN_CANVAS_SIZE ||
			w > MAX_CANVAS_SIZE ||
			h > MAX_CANVAS_SIZE
		) {
			new Notice(
				`Enter a width and height between ${MIN_CANVAS_SIZE} and ${MAX_CANVAS_SIZE} px.`,
			);
			return;
		}
		this.close();
		this.actions.onResize(w, h, this.anchor, false);
	}

	// --- Export ---------------------------------------------------------

	private buildExport(): void {
		this.heading("download", "Export");

		new Setting(this.contentEl)
			.setName("Add to note")
			.setDesc("Create a PNG and embed it — in the note this sketch came from, or one you pick.")
			.addButton((b) =>
				b.setButtonText("Add to note").onClick(() => {
					this.close();
					this.actions.onEmbedPng();
				}),
			);

		// One Share action with a format beside it. iOS's share sheet adapts its
		// options to the file type it's handed, so PNG offers Save Image as well as
		// Save to Files, while SVG only offers Save to Files.
		new Setting(this.contentEl)
			.setName("Share")
			.setDesc("Opens the system share sheet, so you can save to Files or Photos.")
			.addDropdown((dd) => {
				dd.addOption("png", "PNG");
				dd.addOption("svg", "SVG");
				dd.setValue(this.format);
				dd.onChange((v) => {
					this.format = v === "svg" ? "svg" : "png";
				});
			})
			.addButton((b) =>
				b
					.setButtonText("Share")
					.setCta()
					.onClick(() => {
						this.close();
						this.actions.onShare(this.format);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}


/** Fuzzy picker over markdown notes for choosing an embed destination. */
class NotePickerModal extends FuzzySuggestModal<TFile> {
	private picked = false;

	constructor(
		app: App,
		private onResolve: (note: TFile | null) => void,
	) {
		super(app);
		this.setPlaceholder("Choose a note to add the image to…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.picked = true;
		this.onResolve(file);
	}

	onClose(): void {
		super.onClose();
		if (!this.picked) this.onResolve(null);
	}
}
