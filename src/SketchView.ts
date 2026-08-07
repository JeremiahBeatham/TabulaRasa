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
import type TabulaRasaPlugin from "./main";
import { TABULA_RASA_ICON_ID, TABULA_RASA_RESIZE_ICON_ID } from "./icon";

export const VIEW_TYPE_SKETCH = "tabula-rasa-sketch-view";

const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 40;
const SIZE_PRESETS = [2, 6, 12, 24, 40];

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
];

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
		});
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
			await this.app.fileManager.renameFile(file, target);
			new Notice(`Renamed to “${trimmed}”.`);
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
			setIcon(icon, option.icon);
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
		this.canvas?.setBrush(this.brush);
		if (this.toolBtn) {
			setIcon(this.toolBtn, option.icon);
			this.toolBtn.setAttribute("aria-label", option.label);
		}
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

	// --- shared popover -------------------------------------------------

	private togglePopover(
		trigger: HTMLElement,
		build: (pop: HTMLElement) => void,
	): void {
		if (this.popover && this.popoverTrigger === trigger) this.closePopover();
		else this.openPopover(trigger, build);
	}

	private openPopover(
		trigger: HTMLElement,
		build: (pop: HTMLElement) => void,
	): void {
		this.closePopover();
		// Hosted on the leaf, not contentEl: the triggers live in the view header,
		// which sits above contentEl, so anchoring to contentEl would place the
		// popover off the top of the canvas.
		const pop = this.containerEl.createDiv({ cls: "tabula-rasa-popover" });
		this.popover = pop;
		this.popoverTrigger = trigger;
		build(pop);
		this.positionPopover(pop, trigger);

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

	private positionPopover(pop: HTMLElement, trigger: HTMLElement): void {
		const host = this.containerEl.getBoundingClientRect();
		const tr = trigger.getBoundingClientRect();
		pop.style.top = `${tr.bottom - host.top + 6}px`;
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

	private openResizeModal(): void {
		const doc = this.canvas?.getDoc();
		if (!doc) return;
		new ResizeCanvasModal(this.app, {
			width: doc.width,
			height: doc.height,
			hasContent: doc.strokes.length > 0,
			onApply: (w, h, anchor, scaleToFit) =>
				this.canvas?.resizeCanvas(w, h, anchor, scaleToFit),
			onFitToContent: () => this.canvas?.fitCanvasToContent(),
		}).open();
	}

	/**
	 * Everything that isn't drawing. Undo and redo appear here as well as on the
	 * three-finger gestures — a gesture with no visible affordance is invisible
	 * to anyone who hasn't been told about it.
	 */
	private openMoreSheet(): void {
		const doc = this.canvas?.getDoc();
		new MoreSheet(this.app, {
			background: doc?.background ?? "transparent",
			canUndo: this.canvas?.canUndo() ?? false,
			canRedo: this.canvas?.canRedo() ?? false,
			name: this.file?.basename ?? "",
			onRename: (name) => void this.renameSketch(name),
			onCanvasSize: () => this.openResizeModal(),
			onBackground: (value) => {
				this.canvas?.setBackground(value);
				this.requestSave();
			},
			onFit: () => this.canvas?.fitView(),
			onUndo: () => this.canvas?.undo(),
			onRedo: () => this.canvas?.redo(),
			onClear: () => this.canvas?.clear(),
			onExportPng: () => void this.exportPng(),
			onExportSvg: () => void this.plugin.exportActiveSvg(this),
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
	 * Generate a PNG (the only time one is created) and ask whether to embed it
	 * in a note or just keep the image file in the vault.
	 */
	private async exportPng(): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to export yet.");
			return;
		}
		new ExportChoiceModal(this.app, {
			onAddToNote: () => void this.exportAndEmbed(),
			onDownload: () => void this.exportToFile(),
		}).open();
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
	background: string;
	canUndo: boolean;
	canRedo: boolean;
	name: string;
	onRename: (name: string) => void;
	onCanvasSize: () => void;
	onBackground: (value: string) => void;
	onFit: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onClear: () => void;
	onExportPng: () => void;
	onExportSvg: () => void;
}

/**
 * The "more" bottom sheet: canvas and page settings at the top, then the
 * commands that used to crowd the toolbar. Styled to rise from the bottom
 * of the screen so it's reachable one-handed.
 */
class MoreSheet extends Modal {
	constructor(
		app: App,
		private actions: MoreSheetActions,
	) {
		super(app);
	}

	/**
	 * Section headings carry an icon and are set larger than the option titles
	 * beneath them. Obsidian's own setHeading() renders at roughly the same weight
	 * as a setting name, which left the sections losing to their own contents.
	 */
	private heading(icon: string, text: string): void {
		const h = this.contentEl.createDiv({ cls: "tabula-rasa-sheet-heading" });
		const ic = h.createSpan({ cls: "tabula-rasa-sheet-heading-icon" });
		setIcon(ic, icon);
		h.createSpan({ cls: "tabula-rasa-sheet-heading-text", text });
	}

	onOpen(): void {
		this.modalEl.addClass("tabula-rasa-sheet");
		this.titleEl.setText("Sketch options");
		this.contentEl.addClass("tabula-rasa-sheet-body");
		this.heading("file-pen", "Sketch");

		// The filename is hidden from the header to make room for the tools, so
		// this is now the only place to read or change it.
		// No confirm button: the field commits itself shortly after you stop typing,
		// and on blur or Enter. Debounced so a rename isn't attempted per keystroke.
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
					timer = window.setTimeout(commit, 700);
				});
				t.inputEl.addEventListener("blur", commit);
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				});
			});

		this.heading("frame", "Canvas");

		new Setting(this.contentEl)
			.setName("Canvas size")
			.setDesc("Dimensions, aspect presets, or fit tightly to the drawing.")
			.addButton((b) =>
				b.setButtonText("Change").onClick(() => {
					this.close();
					this.actions.onCanvasSize();
				}),
			);

		new Setting(this.contentEl)
			.setName("Canvas colour")
			.setDesc(
				"Transparent takes the colour of whatever the sketch sits on. A solid page is easier to read light ink against.",
			)
			.addDropdown((dd) => {
				dd.addOption("transparent", "Transparent");
				dd.addOption("#ffffff", "White");
				dd.addOption("#1e1e1e", "Dark");
				const current = this.actions.background;
				dd.setValue(
					["transparent", "#ffffff", "#1e1e1e"].includes(current)
						? current
						: "transparent",
				);
				dd.onChange((value) => this.actions.onBackground(value));
			});

		new Setting(this.contentEl)
			.setName("Fit to screen")
			.setDesc("Reset zoom, pan and rotation.")
			.addButton((b) =>
				b.setButtonText("Fit").onClick(() => {
					this.close();
					this.actions.onFit();
				}),
			);

		this.heading("history", "Edit");

		new Setting(this.contentEl)
			.setName("Undo and redo")
			.setDesc("Or swipe with three fingers on the canvas.")
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

		this.heading("download", "Export");

		new Setting(this.contentEl)
			.setName("Export as PNG")
			.setDesc("Add the image to a note, or just save it to the vault.")
			.addButton((b) =>
				b.setButtonText("PNG").onClick(() => {
					this.close();
					this.actions.onExportPng();
				}),
			);

		new Setting(this.contentEl)
			.setName("Export as SVG")
			.setDesc("Save a vector copy alongside the sketch.")
			.addButton((b) =>
				b.setButtonText("SVG").onClick(() => {
					this.close();
					this.actions.onExportSvg();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Two-choice dialog shown when exporting: embed in a note, or just keep the file. */
class ExportChoiceModal extends Modal {
	constructor(
		app: App,
		private actions: { onAddToNote: () => void; onDownload: () => void },
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Export sketch as image");
		this.contentEl.createEl("p", {
			text: "A PNG will be created from your sketch. Where should it go?",
		});
		new Setting(this.contentEl)
			.setName("Add to a note")
			.setDesc("Create the image and embed it in a note.")
			.addButton((b) =>
				b
					.setButtonText("Add to note")
					.setCta()
					.onClick(() => {
						this.close();
						this.actions.onAddToNote();
					}),
			);
		new Setting(this.contentEl)
			.setName("Just save the image")
			.setDesc("Keep the PNG file in your vault without embedding it.")
			.addButton((b) =>
				b.setButtonText("Save image").onClick(() => {
					this.close();
					this.actions.onDownload();
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

interface ResizeActions {
	width: number;
	height: number;
	hasContent: boolean;
	onApply: (
		width: number,
		height: number,
		anchor: CanvasAnchor,
		scaleToFit: boolean,
	) => void;
	onFitToContent: () => void;
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

/** Dialog for changing the canvas dimensions / aspect ratio from the page. */
class ResizeCanvasModal extends Modal {
	private width: number;
	private height: number;
	private anchor: CanvasAnchor = "center";
	private scaleToFit = false;
	private widthInput: HTMLInputElement | null = null;
	private heightInput: HTMLInputElement | null = null;

	constructor(
		app: App,
		private actions: ResizeActions,
	) {
		super(app);
		this.width = actions.width;
		this.height = actions.height;
	}

	onOpen(): void {
		this.titleEl.setText("Canvas size");

		const presets = new Setting(this.contentEl)
			.setName("Presets")
			.setDesc("Apply a common size or aspect ratio.");
		for (const p of RESIZE_PRESETS) {
			presets.addButton((b) =>
				b.setButtonText(p.label).onClick(() => {
					this.width = p.width;
					this.height = p.height;
					this.syncInputs();
				}),
			);
		}

		new Setting(this.contentEl).setName("Width").setDesc("Pixels.").addText(
			(t) => {
				t.inputEl.type = "number";
				t.setValue(String(this.width));
				this.widthInput = t.inputEl;
				t.onChange((v) => {
					this.width = Number(v);
				});
			},
		);

		new Setting(this.contentEl)
			.setName("Height")
			.setDesc("Pixels.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(this.height));
				this.heightInput = t.inputEl;
				t.onChange((v) => {
					this.height = Number(v);
				});
			});

		new Setting(this.contentEl)
			.setName("Anchor")
			.setDesc("Where your drawing stays when the canvas size changes.")
			.addDropdown((dd) => {
				for (const a of ANCHOR_OPTIONS) dd.addOption(a.value, a.label);
				dd.setValue(this.anchor);
				dd.onChange((v) => {
					this.anchor = v as CanvasAnchor;
				});
			});

		new Setting(this.contentEl)
			.setName("Scale drawing to fit")
			.setDesc(
				"Resize your existing strokes to fill the new canvas instead of just repositioning them.",
			)
			.addToggle((t) =>
				t.setValue(this.scaleToFit).onChange((v) => {
					this.scaleToFit = v;
				}),
			);

		new Setting(this.contentEl)
			.setName("Fit to drawing")
			.setDesc(
				this.actions.hasContent
					? "Shrink the canvas to tightly wrap your drawing."
					: "Draw something first to use this.",
			)
			.addButton((b) => {
				b.setButtonText("Fit to drawing");
				b.setDisabled(!this.actions.hasContent);
				b.onClick(() => {
					this.close();
					this.actions.onFitToContent();
				});
			});

		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText("Apply")
					.setCta()
					.onClick(() => this.apply()),
			)
			.addButton((b) =>
				b.setButtonText("Cancel").onClick(() => this.close()),
			);
	}

	private syncInputs(): void {
		if (this.widthInput) this.widthInput.value = String(this.width);
		if (this.heightInput) this.heightInput.value = String(this.height);
	}

	private apply(): void {
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
		this.actions.onApply(w, h, this.anchor, this.scaleToFit);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
