import {
	type Component,
	type Container,
	type SelectItem,
	SelectList,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { SettingsManager } from "../../core/settings-manager.ts";
import {
	getAllSetupStepIds,
	getPendingSetupStepIds,
	markSetupStepComplete,
	type SetupStepId,
} from "../../core/setup-state.ts";
import { getDefaultTheme, getSelectListTheme, setTheme, theme } from "./theme/theme.ts";

type SetupWizardMode = "automatic" | "manual";
type SetupStepOutcome = "completed" | "cancelled" | "back" | { profileRequested: true };
type ThemeSetupChoice = "dark" | "light";

const SETUP_LOGO_LINES = ["██████", "██  ██", "████  ██", "██    ██"];

interface SetupWizardMountOptions {
	parent: Container;
	before: Component;
}

export interface SetupWizardOptions {
	tui: TUI;
	settingsManager: SettingsManager;
	agentDir: string;
	mode: SetupWizardMode;
	steps?: readonly SetupStepId[];
	container: Container;
	mount?: SetupWizardMountOptions;
	focusAfter?: Component;
}

export interface SetupWizardResult {
	completed: boolean;
	cancelled: boolean;
	completedSteps: SetupStepId[];
	profileRequested?: boolean;
}

function mountSetupContainer(options: SetupWizardOptions): void {
	if (!options.mount || options.mount.parent.children.includes(options.container)) {
		return;
	}

	const insertIndex = options.mount.parent.children.indexOf(options.mount.before);
	if (insertIndex === -1) {
		options.mount.parent.addChild(options.container);
		return;
	}
	options.mount.parent.children.splice(insertIndex, 0, options.container);
}

function unmountSetupContainer(options: SetupWizardOptions): void {
	if (options.mount) {
		options.mount.parent.removeChild(options.container);
	}
}

function showSetupComponent(options: SetupWizardOptions, component: Component): () => void {
	mountSetupContainer(options);
	options.container.clear();
	options.container.addChild(component);
	options.tui.setFocus(component);
	options.tui.requestRender();
	return () => {
		options.container.clear();
		unmountSetupContainer(options);
		options.tui.setFocus(options.focusAfter ?? null);
		options.tui.requestRender();
	};
}

function pushSetupLogo(lines: string[], width: number): void {
	for (const line of SETUP_LOGO_LINES) {
		lines.push(truncateToWidth(`  ${theme.fg("accent", line)}`, width, ""));
	}
	lines.push("");
}

function toThemeSetupChoice(value: string | undefined): ThemeSetupChoice {
	return value === "light" ? "light" : "dark";
}

class ThemeSetupComponent implements Component {
	private readonly selectList: SelectList;
	private readonly currentTheme: ThemeSetupChoice;
	private readonly canGoBack: boolean;

	constructor(
		currentTheme: string | undefined,
		canGoBack: boolean,
		onSelectTheme: (themeName: ThemeSetupChoice) => void,
		onPreviewTheme: (themeName: ThemeSetupChoice) => void,
		onBack: () => void,
		onCancel: () => void,
	) {
		this.currentTheme = toThemeSetupChoice(currentTheme);
		this.canGoBack = canGoBack;
		const items: SelectItem[] = [
			{ value: "dark", label: "Dark" },
			{ value: "light", label: "Light" },
		];
		this.selectList = new SelectList(items, items.length, getSelectListTheme(), {
			minPrimaryColumnWidth: 10,
			maxPrimaryColumnWidth: 12,
		});
		this.selectList.setSelectedIndex(items.findIndex((item) => item.value === this.currentTheme));
		this.selectList.onSelect = (item) => {
			onSelectTheme(toThemeSetupChoice(item.value));
		};
		this.selectList.onCancel = () => {
			if (this.canGoBack) {
				onBack();
			} else {
				onCancel();
			}
		};
		this.selectList.onSelectionChange = (item) => {
			onPreviewTheme(toThemeSetupChoice(item.value));
		};
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, width, ""));

		pushSetupLogo(lines, width);
		push(`  ${theme.fg("accent", theme.bold("Welcome to Pi, the minimal coding agent."))}`);
		push();
		push(`  ${theme.fg("text", "Choose your theme")}`);
		push();
		lines.push(...this.selectList.render(width));
		push();
		const backHint = this.canGoBack ? " · Esc to go back" : " · Esc to skip setup";
		push(`  ${theme.fg("dim", `Enter to continue · ↑/↓ to preview${backHint}`)}`);

		return lines;
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}

	invalidate(): void {
		this.selectList.invalidate();
	}
}

class PiDevProfileSetupComponent implements Component {
	private readonly selectList: SelectList;
	private readonly canGoBack: boolean;

	constructor(
		canGoBack: boolean,
		onCreateProfile: () => void,
		onSkip: () => void,
		onBack: () => void,
		onCancel: () => void,
	) {
		this.canGoBack = canGoBack;
		const items: SelectItem[] = [
			{
				value: "create-profile",
				label: "Create profile or sign in",
			},
			{
				value: "skip",
				label: "Continue without pi.dev profile",
			},
		];
		this.selectList = new SelectList(items, items.length, getSelectListTheme(), {
			minPrimaryColumnWidth: 30,
			maxPrimaryColumnWidth: 34,
		});
		this.selectList.onSelect = (item) => {
			if (item.value === "create-profile") {
				onCreateProfile();
				return;
			}
			onSkip();
		};
		this.selectList.onCancel = () => {
			if (this.canGoBack) {
				onBack();
			} else {
				onCancel();
			}
		};
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, width, ""));

		pushSetupLogo(lines, width);
		push(`  ${theme.fg("accent", theme.bold("Welcome to Pi, the minimal coding agent."))}`);
		push();
		push(`  ${theme.fg("text", "Create a pi.dev profile to enable activity sync and storing of sessions")}`);
		push();
		lines.push(...this.selectList.render(width));
		push();
		const backHint = this.canGoBack ? " · Esc to go back" : " · Esc to skip setup";
		push(`  ${theme.fg("dim", `Enter to continue${backHint}`)}`);

		return lines;
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}

	invalidate(): void {
		this.selectList.invalidate();
	}
}

async function runThemeSetupStep(options: SetupWizardOptions, canGoBack: boolean): Promise<SetupStepOutcome> {
	return new Promise((resolve) => {
		let closeComponent: (() => void) | undefined;
		let closed = false;

		const previewTheme = (themeName: ThemeSetupChoice) => {
			setTheme(themeName);
			options.tui.requestRender();
		};

		const finish = (themeName: ThemeSetupChoice) => {
			if (closed) {
				return;
			}
			closed = true;
			setTheme(themeName);
			options.settingsManager.setTheme(themeName);
			markSetupStepComplete("theme", options.agentDir);
			const close = () => {
				closeComponent?.();
				options.tui.requestRender();
				resolve("completed");
			};
			void options.settingsManager.flush().then(close, close);
		};

		const closeWithoutSaving = (outcome: "back" | "cancelled") => {
			if (closed) {
				return;
			}
			closed = true;
			setTheme(options.settingsManager.getTheme() ?? getDefaultTheme());
			closeComponent?.();
			options.tui.requestRender();
			resolve(outcome);
		};

		const goBack = () => closeWithoutSaving("back");
		const cancel = () => closeWithoutSaving("cancelled");

		const themeSetup = new ThemeSetupComponent(
			options.settingsManager.getTheme() ?? getDefaultTheme(),
			canGoBack,
			finish,
			previewTheme,
			goBack,
			cancel,
		);
		closeComponent = showSetupComponent(options, themeSetup);
	});
}

async function runPiDevProfileSetupStep(options: SetupWizardOptions, canGoBack: boolean): Promise<SetupStepOutcome> {
	return new Promise((resolve) => {
		let closeComponent: (() => void) | undefined;
		let closed = false;

		const finish = (outcome: SetupStepOutcome) => {
			if (closed) {
				return;
			}
			closed = true;
			markSetupStepComplete("pi-dev-profile", options.agentDir);
			closeComponent?.();
			options.tui.requestRender();
			resolve(outcome);
		};

		const closeWithoutCompleting = (outcome: "back" | "cancelled") => {
			if (closed) {
				return;
			}
			closed = true;
			closeComponent?.();
			options.tui.requestRender();
			resolve(outcome);
		};

		const goBack = () => closeWithoutCompleting("back");
		const cancel = () => closeWithoutCompleting("cancelled");

		const profile = new PiDevProfileSetupComponent(
			canGoBack,
			() => finish({ profileRequested: true }),
			() => finish("completed"),
			goBack,
			cancel,
		);
		closeComponent = showSetupComponent(options, profile);
	});
}

async function runSetupStep(
	options: SetupWizardOptions,
	step: SetupStepId,
	canGoBack: boolean,
): Promise<SetupStepOutcome> {
	switch (step) {
		case "theme":
			return runThemeSetupStep(options, canGoBack);
		case "pi-dev-profile":
			return runPiDevProfileSetupStep(options, canGoBack);
	}
}

async function completeAutomaticSetupWithDefaults(
	options: SetupWizardOptions,
	steps: SetupStepId[],
	completedSteps: SetupStepId[],
	profileRequested: boolean,
): Promise<SetupWizardResult> {
	const completedSet = new Set(completedSteps);
	const completeStep = (step: SetupStepId) => {
		if (completedSet.has(step)) {
			return;
		}
		markSetupStepComplete(step, options.agentDir);
		completedSet.add(step);
		completedSteps.push(step);
	};

	if (steps.includes("theme") && !completedSet.has("theme")) {
		completeStep("theme");
	}
	if (steps.includes("pi-dev-profile") && !completedSet.has("pi-dev-profile")) {
		completeStep("pi-dev-profile");
	}

	await options.settingsManager.flush();
	return { completed: true, cancelled: false, completedSteps, profileRequested };
}

export async function runSetupWizard(options: SetupWizardOptions): Promise<SetupWizardResult> {
	const steps = [
		...(options.steps ??
			(options.mode === "manual"
				? getAllSetupStepIds()
				: getPendingSetupStepIds(options.agentDir, {
						themeConfigured: options.settingsManager.getTheme() !== undefined,
					}))),
	];
	const completedSteps: SetupStepId[] = [];
	let profileRequested = false;
	let index = 0;
	const removeCompletedStepsFromIndex = (fromIndex: number) => {
		for (let completedIndex = completedSteps.length - 1; completedIndex >= 0; completedIndex--) {
			const stepIndex = steps.indexOf(completedSteps[completedIndex]);
			if (stepIndex >= fromIndex) {
				if (completedSteps[completedIndex] === "pi-dev-profile") {
					profileRequested = false;
				}
				completedSteps.splice(completedIndex, 1);
			}
		}
	};

	while (index < steps.length) {
		const step = steps[index];
		const outcome = await runSetupStep(options, step, index > 0);
		if (outcome === "back") {
			if (index > 0) {
				index--;
				removeCompletedStepsFromIndex(index);
			}
			continue;
		}
		if (outcome === "cancelled") {
			if (options.mode === "automatic") {
				return completeAutomaticSetupWithDefaults(options, steps, completedSteps, profileRequested);
			}
			return { completed: false, cancelled: true, completedSteps, profileRequested };
		}
		if (typeof outcome === "object") {
			profileRequested = outcome.profileRequested;
		}
		completedSteps.push(step);
		index++;
	}

	return { completed: true, cancelled: false, completedSteps, profileRequested };
}
