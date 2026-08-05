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
	desc: string;
}

const TOOL_OPTIONS: ToolOption[] = [
	{ id: "pen", tool: "pen", icon: "pen", label: "Pen", desc: "Crisp, even line." },
	{
		id: "brush",
		tool: "brush",
		icon: "brush",
		label: "Brush",
		desc: "Soft, tapered, pressure-led.",
	},
	{
		id: "highlighter",
		tool: "highlighter",
		icon: "highlighter",
		label: "Highlighter",
		desc: "Flat translucent marker.",
	},
	{
		id: "eraser-object",
		tool: "eraser",
		eraserMode: "stroke",
		icon: "eraser",
		label: "Eraser — objects",
		desc: "Removes a whole stroke on touch.",
	},
	{
		id: "eraser-pixel",
		tool: "eraser",
		eraserMode: "partial",
		icon: "eraser",
		label: "Eraser — pixels",
		desc: "Rubs out only the part you touch.",
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

	// Shared popover (tool list / brush size).
	private popover: HTMLElement | null = null;
	private popoverTrigger: HTMLElement | null = null;
	private closePopoverHandler: ((e: Event) => void) | null = null;

	// Brush-size popover state.
	private sizeTriggerDot: HTMLElement | null = null;
	private sizeSlider: HTMLInputElement | null = null;
	private sizePreviewDot: HTMLElement | null = null;
	private sizeValueLabel: HTMLElement | null = null;
	private sizePresetButtons = new Map<number, HTMLElement>();

	/** Hidden <input type="color">; clicking it summons the system colour sheet. */
	private colorInput: HTMLInputElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TabulaRasaPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.doc = createEmptyDoc(
			plugin.settings.canvasWidth,
			plugin.settings.canvasHeight,
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
		this.doc = createEmptyDoc(
			this.plugin.settings.canvasWidth,
			this.plugin.settings.canvasHeight,
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

		this.toolBtn = this.makeAction("pen", "Tool", (btn) =>
			this.togglePopover(btn, (pop) => this.buildToolPopover(pop)),
		);

		// The size button shows a dot scaled to the current brush, so the setting
		// is legible without opening anything.
		this.sizeBtn = this.makeAction("", "Brush size", (btn) =>
			this.togglePopover(btn, (pop) => this.buildSizePopover(pop)),
		);
		this.sizeTriggerDot = this.sizeBtn.createDiv({ cls: "tabula-rasa-size-dot" });

		// The colour control is the <input type="color"> itself, stretched over the
		// swatch and made invisible. iOS only raises the system Colors sheet for a
		// genuine tap on the input — a synthetic .click() on a hidden one is
		// ignored, which is why the button did nothing before.
		this.colorBtn = this.makeAction("", "Colour", () => {
			/* the overlaid input handles activation */
		});
		this.colorBtn.addClass("tabula-rasa-color-btn");
		this.colorInput = this.colorBtn.createEl("input", {
			cls: "tabula-rasa-color-input",
			attr: { type: "color", "aria-label": "Colour" },
		});
		this.colorInput.value = normalizeHex(this.brush.color);
		this.colorInput.addEventListener("input", () =>
			this.selectColor(this.colorInput?.value ?? this.brush.color),
		);

		this.makeAction("more-horizontal", "Sketch options", () =>
			this.openMoreSheet(),
		);

		this.applyTool(this.currentToolOption());
		this.selectColor(this.brush.color);
		this.selectSize(this.brush.size);
	}

	/**
	 * addAction() puts the button in the view header's action row, to the left of
	 * Obsidian's own "..." — exactly where we want it — and returns the element so
	 * we can swap in custom content like the colour wheel or the size dot.
	 */
	private makeAction(
		icon: string,
		label: string,
		onClick: (btn: HTMLElement) => void,
	): HTMLElement {
		const btn = this.addAction(icon || "circle", label, () => onClick(btn));
		btn.addClass("tabula-rasa-btn");
		if (!icon) btn.empty();
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
		pop.createDiv({ cls: "tabula-rasa-popover-label", text: "Tool" });
		const activeId = this.currentToolOption().id;
		for (const option of TOOL_OPTIONS) {
			const row = pop.createEl("button", {
				cls: "tabula-rasa-mode-option",
				attr: { type: "button" },
			});
			row.toggleClass("is-active", option.id === activeId);
			const icon = row.createSpan({ cls: "tabula-rasa-mode-icon" });
			setIcon(icon, option.icon);
			const text = row.createDiv({ cls: "tabula-rasa-mode-text" });
			text.createDiv({ cls: "tabula-rasa-mode-name", text: option.label });
			text.createDiv({ cls: "tabula-rasa-mode-desc", text: option.desc });
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
		this.sizePreviewDot = null;
		this.sizeValueLabel = null;
		this.sizePresetButtons.clear();
		// colorInput deliberately survives: it lives on the toolbar, not in here.
	}

	// --- brush size -----------------------------------------------------

	private buildSizePopover(pop: HTMLElement): void {
		pop.createDiv({ cls: "tabula-rasa-popover-label", text: "Size" });

		const presets = pop.createDiv({ cls: "tabula-rasa-size-presets" });
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

		const slider = pop.createEl("input", {
			cls: "tabula-rasa-size-slider",
			attr: {
				type: "range",
				min: String(MIN_BRUSH_SIZE),
				max: String(MAX_BRUSH_SIZE),
				step: "1",
				"aria-label": "Brush size",
			},
		});
		this.sizeSlider = slider;
		slider.addEventListener("input", () =>
			this.selectSize(Number(slider.value)),
		);

		const preview = pop.createDiv({ cls: "tabula-rasa-size-preview" });
		this.sizePreviewDot = preview.createDiv({
			cls: "tabula-rasa-size-preview-dot",
		});

		// The readout doubles as the way in to typing an exact value.
		this.sizeValueLabel = pop.createEl("button", {
			cls: "tabula-rasa-size-value",
			attr: { type: "button", "aria-label": "Edit brush size" },
		});
		this.sizeValueLabel.addEventListener("click", () => this.editSizeValue());

		this.updateSizeUI();
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
		if (this.sizeSlider && this.sizeSlider.value !== String(size)) {
			this.sizeSlider.value = String(size);
		}
		this.sizeValueLabel?.setText(`${size} px`);
		if (this.sizePreviewDot) {
			const d = Math.max(2, Math.min(48, size));
			this.sizePreviewDot.style.width = `${d}px`;
			this.sizePreviewDot.style.height = `${d}px`;
		}
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

	onOpen(): void {
		this.modalEl.addClass("tabula-rasa-sheet");
		this.titleEl.setText("Sketch options");

		// The filename is hidden from the header to make room for the tools, so
		// this is now the only place to read or change it.
		let pendingName = this.actions.name;
		new Setting(this.contentEl)
			.setName("Name")
			.setDesc("Renaming updates links to this sketch in your notes.")
			.addText((t) => {
				t.setValue(this.actions.name);
				t.onChange((v) => {
					pendingName = v;
				});
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						this.close();
						this.actions.onRename(pendingName);
					}
				});
			})
			.addButton((b) =>
				b.setButtonText("Rename").onClick(() => {
					this.close();
					this.actions.onRename(pendingName);
				}),
			);

		new Setting(this.contentEl).setName("Canvas").setHeading();

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

		new Setting(this.contentEl).setName("Edit").setHeading();

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

		new Setting(this.contentEl).setName("Export").setHeading();

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
