import {
	TextFileView,
	WorkspaceLeaf,
	setIcon,
	Notice,
	debounce,
	Debouncer,
} from "obsidian";
import { SketchCanvas, BrushSettings } from "./canvas";
import {
	SketchDoc,
	ToolName,
	createEmptyDoc,
	parseDoc,
	serializeDoc,
} from "./model";
import type ObsidianBoardPlugin from "./main";

export const VIEW_TYPE_SKETCH = "obsidianboard-sketch-view";

const PALETTE = [
	"#000000",
	"#e03131",
	"#1971c2",
	"#2f9e44",
	"#f08c00",
	"#9c36b5",
	"#ffffff",
];

const BRUSH_SIZES = [3, 6, 12, 24];

/**
 * Full-screen editor for `.sketch` files. Extends TextFileView so Obsidian
 * handles file load/save and the dirty indicator; we serialize the SketchDoc
 * as the file's text content.
 */
export class SketchView extends TextFileView {
	private plugin: ObsidianBoardPlugin;
	private doc: SketchDoc;
	private canvas: SketchCanvas | null = null;
	private canvasHost: HTMLElement | null = null;
	private brush: BrushSettings;
	private resizeObserver: ResizeObserver | null = null;

	private toolButtons = new Map<ToolName, HTMLElement>();
	private colorButtons = new Map<string, HTMLElement>();
	private sizeButtons = new Map<number, HTMLElement>();
	private undoBtn: HTMLElement | null = null;
	private redoBtn: HTMLElement | null = null;
	private schedulePngRefresh: Debouncer<[], void>;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianBoardPlugin) {
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
		};
		// Keep the embedded PNG export in sync shortly after drawing stops.
		this.schedulePngRefresh = debounce(
			() => {
				if (this.file) {
					void this.plugin
						.exportSketchToPng(this.file, this.getViewData())
						.catch((e) => console.error("PNG auto-export failed", e));
				}
			},
			1500,
			true,
		);
	}

	getViewType(): string {
		return VIEW_TYPE_SKETCH;
	}

	getIcon(): string {
		return "pencil";
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
		this.contentEl.addClass("obsidianboard-view");
		this.applyThemeDefaultColor();
		this.buildToolbar();
		this.canvasHost = this.contentEl.createDiv({
			cls: "obsidianboard-canvas-host",
		});
		this.rebuildCanvas();

		this.resizeObserver = new ResizeObserver(() => this.canvas?.resize());
		if (this.canvasHost) this.resizeObserver.observe(this.canvasHost);
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		// Capture the final state into the embedded PNG before tearing down.
		if (this.file && this.canvas) {
			await this.plugin
				.exportSketchToPng(this.file, this.getViewData())
				.catch((e) => console.error("PNG export on close failed", e));
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
			onChange: () => {
				this.requestSave();
				this.refreshHistoryButtons();
				this.schedulePngRefresh();
			},
		});
		// Defer sizing until layout settles (important on mobile open).
		window.setTimeout(() => this.canvas?.resize(), 0);
		this.refreshHistoryButtons();
	}

	// --- toolbar --------------------------------------------------------

	private buildToolbar(): void {
		const bar = this.contentEl.createDiv({ cls: "obsidianboard-toolbar" });

		const tools: { tool: ToolName; icon: string; label: string }[] = [
			{ tool: "pen", icon: "pencil", label: "Pen" },
			{ tool: "highlighter", icon: "highlighter", label: "Highlighter" },
			{ tool: "eraser", icon: "eraser", label: "Eraser" },
		];
		const toolGroup = bar.createDiv({ cls: "obsidianboard-group" });
		for (const t of tools) {
			const btn = this.makeButton(toolGroup, t.icon, t.label, () =>
				this.selectTool(t.tool),
			);
			this.toolButtons.set(t.tool, btn);
		}

		const colorGroup = bar.createDiv({ cls: "obsidianboard-group" });
		for (const color of PALETTE) {
			const swatch = colorGroup.createEl("button", {
				cls: "obsidianboard-swatch",
				attr: { "aria-label": color, type: "button" },
			});
			swatch.style.backgroundColor = color;
			swatch.addEventListener("click", () => this.selectColor(color));
			this.colorButtons.set(color, swatch);
		}

		const sizeGroup = bar.createDiv({ cls: "obsidianboard-group" });
		for (const size of BRUSH_SIZES) {
			const btn = sizeGroup.createEl("button", {
				cls: "obsidianboard-size",
				attr: { "aria-label": `Size ${size}`, type: "button" },
			});
			const dot = btn.createDiv({ cls: "obsidianboard-size-dot" });
			const px = Math.max(4, Math.min(22, size));
			dot.style.width = `${px}px`;
			dot.style.height = `${px}px`;
			btn.addEventListener("click", () => this.selectSize(size));
			this.sizeButtons.set(size, btn);
		}

		const actionGroup = bar.createDiv({ cls: "obsidianboard-group" });
		this.undoBtn = this.makeButton(actionGroup, "undo-2", "Undo", () =>
			this.canvas?.undo(),
		);
		this.redoBtn = this.makeButton(actionGroup, "redo-2", "Redo", () =>
			this.canvas?.redo(),
		);
		this.makeButton(actionGroup, "trash-2", "Clear", () => {
			this.canvas?.clear();
		});
		this.makeButton(actionGroup, "maximize", "Fit to screen", () => {
			this.canvas?.fitView();
		});
		this.makeButton(actionGroup, "image-down", "Export PNG", () => {
			void this.exportPng();
		});
		this.makeButton(actionGroup, "check", "Save sketch", () => {
			void this.saveAndExport();
		});

		this.selectTool(this.brush.tool);
		this.selectColor(this.brush.color);
		this.selectSize(this.brush.size);
	}

	private makeButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): HTMLElement {
		const btn = parent.createEl("button", {
			cls: "obsidianboard-btn",
			attr: { "aria-label": label, type: "button" },
		});
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private selectTool(tool: ToolName): void {
		this.brush.tool = tool;
		// Highlighter is semi-transparent and wider; eraser uses brush size.
		if (tool === "highlighter") {
			this.brush.opacity = 0.4;
		} else {
			this.brush.opacity = 1;
		}
		this.canvas?.setBrush(this.brush);
		this.toolButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === tool),
		);
	}

	private selectColor(color: string): void {
		this.brush.color = color;
		this.canvas?.setBrush(this.brush);
		this.colorButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === color),
		);
	}

	private selectSize(size: number): void {
		this.brush.size = size;
		this.canvas?.setBrush(this.brush);
		this.sizeButtons.forEach((btn, key) =>
			btn.toggleClass("is-active", key === size),
		);
	}

	private refreshHistoryButtons(): void {
		if (this.undoBtn) this.undoBtn.toggleClass("is-disabled", !this.canvas?.canUndo());
		if (this.redoBtn) this.redoBtn.toggleClass("is-disabled", !this.canvas?.canRedo());
	}

	/** Pick a starting pen color that's visible on the current theme background. */
	private applyThemeDefaultColor(): void {
		if (!this.plugin.settings.matchPenColorToTheme) return;
		const isDark = document.body.classList.contains("theme-dark");
		this.brush.color = isDark ? "#ffffff" : "#000000";
	}

	/**
	 * Explicitly write the .sketch source and refresh the embedded PNG, then
	 * confirm — making it clear the drawing also lives as a separate image file.
	 */
	private async saveAndExport(): Promise<void> {
		if (!this.file) {
			new Notice("Nothing to save yet.");
			return;
		}
		try {
			const data = this.getViewData();
			await this.app.vault.modify(this.file, data);
			const pngPath = await this.plugin.exportSketchToPng(this.file, data);
			const pngName = pngPath.split("/").pop() ?? pngPath;
			new Notice(
				`Sketch saved. Embedded image “${pngName}” updated — the .sketch file stays editable.`,
			);
		} catch (e) {
			console.error(e);
			new Notice("Save failed. See console for details.");
		}
	}

	private async exportPng(): Promise<void> {
		if (!this.file) {
			new Notice("Save the sketch first.");
			return;
		}
		try {
			const path = await this.plugin.exportSketchToPng(
				this.file,
				this.getViewData(),
			);
			new Notice(`Exported PNG: ${path}`);
		} catch (e) {
			console.error(e);
			new Notice("PNG export failed. See console for details.");
		}
	}
}
