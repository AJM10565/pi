import {
	type Component,
	type Container,
	type SelectItem,
	SelectList,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { SettingsManager } from "../../core/settings-manager.ts";
import {
	getAllSetupStepIds,
	getPendingSetupStepIds,
	markSetupStepComplete,
	type SetupStepId,
} from "../../core/setup-state.ts";
import {
	detectTerminalBackground,
	getSelectListTheme,
	getThemeForRgbColor,
	parseOsc11BackgroundColor,
	setTheme,
	type TerminalThemeDetection,
	theme,
} from "./theme/theme.ts";

type SetupWizardMode = "automatic" | "manual";
type SetupLoginRequest = "oauth" | "api_key";
type SetupStepOutcome = "completed" | "cancelled" | { loginRequest: SetupLoginRequest };

export const SETUP_LOGO_LINES = ["██████", "██  ██", "████  ██", "██    ██"];

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
	onThemeApplied?: () => void;
}

export interface SetupWizardResult {
	completed: boolean;
	cancelled: boolean;
	completedSteps: SetupStepId[];
	loginRequest?: SetupLoginRequest;
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

class LoginSetupComponent implements Component {
	private readonly selectList: SelectList;

	constructor(onLogin: (request: SetupLoginRequest) => void, onSkip: () => void) {
		const items: SelectItem[] = [
			{
				value: "oauth",
				label: "Log in with subscription",
				description: "Use Claude, ChatGPT, or GitHub Copilot",
			},
			{
				value: "api_key",
				label: "Add an API key",
				description: "Store a provider API key",
			},
			{
				value: "skip",
				label: "Skip",
				description: "Use /login later",
			},
		];
		this.selectList = new SelectList(items, items.length, getSelectListTheme(), {
			minPrimaryColumnWidth: 26,
			maxPrimaryColumnWidth: 30,
		});
		this.selectList.onSelect = (item) => {
			if (item.value === "oauth" || item.value === "api_key") {
				onLogin(item.value);
				return;
			}
			onSkip();
		};
		this.selectList.onCancel = onSkip;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, width, ""));
		const description = "Connect a subscription or API key now. You can skip this and run /login later.";

		pushSetupLogo(lines, width);
		push(`  ${theme.fg("accent", theme.bold("Log in to a provider"))}`);
		push();
		for (const line of wrapTextWithAnsi(theme.fg("muted", description), Math.max(1, width - 4))) {
			push(`  ${line}`);
		}
		push();
		lines.push(...this.selectList.render(width));
		push();
		push(`  ${theme.fg("dim", "Enter to continue · Esc to skip")}`);

		return lines;
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}

	invalidate(): void {
		this.selectList.invalidate();
	}
}

class TelemetryConsentComponent implements Component {
	private readonly selectList: SelectList;
	private readonly hint: string;
	private readonly showWelcome: boolean;

	constructor(
		currentEnabled: boolean,
		onSelect: (enabled: boolean) => void,
		onCancel: () => void,
		hint: string,
		showWelcome: boolean,
	) {
		this.hint = hint;
		this.showWelcome = showWelcome;
		const items: SelectItem[] = [
			{
				value: "disabled",
				label: "Do not send",
				description: "Default. Disable crash reporting and analytics",
			},
			{
				value: "enabled",
				label: "Allow",
				description: "Send anonymous diagnostics to help improve Pi",
			},
		];
		this.selectList = new SelectList(items, items.length, getSelectListTheme(), {
			minPrimaryColumnWidth: 18,
			maxPrimaryColumnWidth: 24,
		});
		this.selectList.setSelectedIndex(currentEnabled ? 1 : 0);
		this.selectList.onSelect = (item) => {
			onSelect(item.value === "enabled");
		};
		this.selectList.onCancel = onCancel;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const push = (line = "") => lines.push(truncateToWidth(line, width, ""));
		const description =
			"Allow Pi to send anonymous diagnostics to improve reliability. This includes version/update analytics and crash reports when crash reporting is available. Prompts, responses, file contents, and API keys are not sent.";

		pushSetupLogo(lines, width);
		if (this.showWelcome) {
			push(`  ${theme.fg("accent", theme.bold("Welcome to Pi."))}`);
			push();
		}
		push(`  ${theme.fg("accent", theme.bold("Crash reporting and analytics"))}`);
		push();
		for (const line of wrapTextWithAnsi(theme.fg("muted", description), Math.max(1, width - 4))) {
			push(`  ${line}`);
		}
		push();
		lines.push(...this.selectList.render(width));
		push();
		push(`  ${theme.fg("dim", this.hint)}`);

		return lines;
	}

	handleInput(data: string): void {
		this.selectList.handleInput(data);
	}

	invalidate(): void {
		this.selectList.invalidate();
	}
}

function previewTheme(themeName: string, tui: TUI, onThemeApplied: (() => void) | undefined): boolean {
	const result = setTheme(themeName, true);
	tui.invalidate();
	onThemeApplied?.();
	tui.requestRender();
	return result.success;
}

function queryTerminalBackground(tui: TUI, timeoutMs = 200): Promise<TerminalThemeDetection | undefined> {
	return new Promise((resolve) => {
		let settled = false;
		let cleanupTimer: NodeJS.Timeout | undefined;
		let resolveTimer: NodeJS.Timeout | undefined;
		let unsubscribe: (() => void) | undefined;

		const cleanup = () => {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = undefined;
			}
			if (cleanupTimer) {
				clearTimeout(cleanupTimer);
				cleanupTimer = undefined;
			}
			if (resolveTimer) {
				clearTimeout(resolveTimer);
				resolveTimer = undefined;
			}
		};

		const finish = (detection: TerminalThemeDetection | undefined) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(detection);
		};

		unsubscribe = tui.addInputListener((data) => {
			const rgb = parseOsc11BackgroundColor(data);
			if (!rgb) {
				return undefined;
			}
			finish({
				theme: getThemeForRgbColor(rgb),
				source: "terminal background",
				detail: `OSC 11 background rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
				confidence: "high",
			});
			return { consume: true };
		});

		resolveTimer = setTimeout(() => finish(undefined), timeoutMs);
		cleanupTimer = setTimeout(cleanup, 2000);
		tui.terminal.write("\x1b]11;?\x07");
	});
}

async function detectSetupTheme(tui: TUI): Promise<TerminalThemeDetection> {
	return (await queryTerminalBackground(tui)) ?? detectTerminalBackground();
}

async function runThemeSetupStep(
	options: SetupWizardOptions,
	initialDetection?: TerminalThemeDetection,
): Promise<SetupStepOutcome> {
	const configuredTheme = options.settingsManager.getTheme();
	if (!configuredTheme) {
		const detection = initialDetection ?? (await detectSetupTheme(options.tui));
		if (previewTheme(detection.theme, options.tui, options.onThemeApplied)) {
			options.settingsManager.setTheme(detection.theme);
			await options.settingsManager.flush();
		}
	}
	markSetupStepComplete("theme", options.agentDir);
	return "completed";
}

async function runTelemetrySetupStep(
	options: SetupWizardOptions,
	isFinalStep: boolean,
	showWelcome: boolean,
): Promise<SetupStepOutcome> {
	return new Promise((resolve) => {
		let closeComponent: (() => void) | undefined;
		let closed = false;

		const finish = (outcome: SetupStepOutcome) => {
			if (closed) {
				return;
			}
			closed = true;
			closeComponent?.();
			options.tui.requestRender();
			resolve(outcome);
		};

		const saveTelemetry = (enabled: boolean) => {
			void (async () => {
				options.settingsManager.setTelemetryEnabled(enabled);
				await options.settingsManager.flush();
				markSetupStepComplete("telemetry", options.agentDir);
				finish("completed");
			})();
		};

		const cancel = () => {
			finish("cancelled");
		};

		const automaticHint = isFinalStep ? "Enter to save and finish" : "Enter to save and continue";
		const manualHint = isFinalStep ? "Enter to save · Esc to cancel" : "Enter to save and continue · Esc to cancel";
		const consent = new TelemetryConsentComponent(
			options.settingsManager.getTelemetryEnabled(),
			saveTelemetry,
			cancel,
			options.mode === "automatic" ? automaticHint : manualHint,
			showWelcome,
		);
		closeComponent = showSetupComponent(options, consent);
	});
}

async function runLoginSetupStep(options: SetupWizardOptions): Promise<SetupStepOutcome> {
	return new Promise((resolve) => {
		let closeComponent: (() => void) | undefined;
		let closed = false;

		const finish = (outcome: SetupStepOutcome) => {
			if (closed) {
				return;
			}
			closed = true;
			markSetupStepComplete("login", options.agentDir);
			closeComponent?.();
			options.tui.requestRender();
			resolve(outcome);
		};

		const login = new LoginSetupComponent(
			(loginRequest) => finish({ loginRequest }),
			() => finish("completed"),
		);
		closeComponent = showSetupComponent(options, login);
	});
}

async function runSetupStep(
	options: SetupWizardOptions,
	step: SetupStepId,
	initialDetection: TerminalThemeDetection | undefined,
	isFinalStep: boolean,
): Promise<SetupStepOutcome> {
	switch (step) {
		case "theme":
			return runThemeSetupStep(options, initialDetection);
		case "telemetry":
			return runTelemetrySetupStep(options, isFinalStep, options.mode === "automatic");
		case "login":
			return runLoginSetupStep(options);
	}
}

async function completeAutomaticSetupWithDefaults(
	options: SetupWizardOptions,
	steps: SetupStepId[],
	completedSteps: SetupStepId[],
	initialDetection: TerminalThemeDetection | undefined,
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
		const configuredTheme = options.settingsManager.getTheme();
		if (!configuredTheme) {
			const detection = initialDetection ?? (await detectSetupTheme(options.tui));
			if (previewTheme(detection.theme, options.tui, options.onThemeApplied)) {
				options.settingsManager.setTheme(detection.theme);
			}
		}
		completeStep("theme");
	}

	if (steps.includes("telemetry") && !completedSet.has("telemetry")) {
		options.settingsManager.setTelemetryEnabled(false);
		completeStep("telemetry");
	}

	if (steps.includes("login") && !completedSet.has("login")) {
		completeStep("login");
	}

	await options.settingsManager.flush();
	return { completed: true, cancelled: false, completedSteps };
}

export async function runSetupWizard(options: SetupWizardOptions): Promise<SetupWizardResult> {
	const steps = [
		...(options.steps ??
			(options.mode === "manual" ? getAllSetupStepIds() : getPendingSetupStepIds(options.agentDir))),
	];
	const completedSteps: SetupStepId[] = [];
	let loginRequest: SetupLoginRequest | undefined;
	let initialDetection: TerminalThemeDetection | undefined;
	if (steps.includes("theme") && !options.settingsManager.getTheme()) {
		initialDetection = await detectSetupTheme(options.tui);
		previewTheme(initialDetection.theme, options.tui, options.onThemeApplied);
	}
	for (let index = 0; index < steps.length; index++) {
		const step = steps[index];
		const outcome = await runSetupStep(options, step, initialDetection, index === steps.length - 1);
		if (outcome === "cancelled") {
			if (options.mode === "automatic") {
				return completeAutomaticSetupWithDefaults(options, steps, completedSteps, initialDetection);
			}
			return { completed: false, cancelled: true, completedSteps, loginRequest };
		}
		if (typeof outcome === "object") {
			loginRequest = outcome.loginRequest;
		}
		completedSteps.push(step);
	}

	return { completed: true, cancelled: false, completedSteps, loginRequest };
}
