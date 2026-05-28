import { Container, ProcessTerminal, setKeybindings, Text, TUI } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { APP_NAME, getAgentDir, VERSION } from "../config.ts";
import { KeybindingsManager } from "../core/keybindings.ts";
import { DefaultResourceLoader } from "../core/resource-loader.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { runSetupWizard } from "../modes/interactive/setup-wizard.ts";
import { initTheme, setRegisteredThemes, stopThemeWatcher, theme } from "../modes/interactive/theme/theme.ts";

function printSetupHelp(): void {
	console.log(`${chalk.bold("Usage:")}
  ${APP_NAME} setup

Run the interactive setup wizard.
`);
}

function reportSettingsErrors(settingsManager: SettingsManager): void {
	for (const { scope, error } of settingsManager.drainErrors()) {
		console.error(chalk.yellow(`Warning (setup command, ${scope} settings): ${error.message}`));
	}
}

export async function handleSetupCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "setup") {
		return false;
	}

	const rest = args.slice(1);
	if (rest.includes("--help") || rest.includes("-h")) {
		printSetupHelp();
		return true;
	}
	const unexpected = rest.find((arg) => arg !== "--help" && arg !== "-h");
	if (unexpected) {
		console.error(chalk.red(`Unexpected argument ${unexpected}.`));
		console.error(chalk.dim(`Usage: ${APP_NAME} setup`));
		process.exitCode = 1;
		return true;
	}
	if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
		console.error(chalk.red(`${APP_NAME} setup requires an interactive terminal.`));
		process.exitCode = 1;
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	reportSettingsErrors(settingsManager);

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	setRegisteredThemes(resourceLoader.getThemes().themes);
	for (const diagnostic of resourceLoader.getThemes().diagnostics) {
		const prefix = diagnostic.path ? `${diagnostic.path}: ` : "";
		console.error(chalk.yellow(`Warning (setup command, theme): ${prefix}${diagnostic.message}`));
	}

	setKeybindings(KeybindingsManager.create());
	initTheme(settingsManager.getTheme(), true);
	const tui = new TUI(new ProcessTerminal(), settingsManager.getShowHardwareCursor());
	tui.setClearOnShrink(settingsManager.getClearOnShrink());
	const headerContainer = new Container();
	headerContainer.addChild(
		new Text(`${theme.bold(theme.fg("accent", APP_NAME))} ${theme.fg("dim", `v${VERSION}`)}\n`, 1, 0),
	);
	const setupContainer = new Container();
	tui.addChild(headerContainer);
	tui.addChild(setupContainer);
	tui.start();

	let completed = false;
	let loginRequest: "oauth" | "api_key" | undefined;
	try {
		const result = await runSetupWizard({
			tui,
			settingsManager,
			agentDir,
			mode: "manual",
			container: setupContainer,
		});
		completed = result.completed;
		loginRequest = result.loginRequest;
	} finally {
		tui.stop();
		stopThemeWatcher();
	}

	console.log(completed ? chalk.green("Setup complete.") : chalk.dim("Setup cancelled."));
	if (loginRequest) {
		const method = loginRequest === "oauth" ? "subscription login" : "API key login";
		console.log(chalk.dim(`Start interactive Pi and run /login to continue ${method}.`));
	}
	return true;
}
