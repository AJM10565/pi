import { Container, ProcessTerminal, setKeybindings, TUI } from "@earendil-works/pi-tui";
import { getStableActivitySyncDeviceId } from "../core/activity-sync/state.ts";
import type { AuthStorage } from "../core/auth-storage.ts";
import { KeybindingsManager } from "../core/keybindings.ts";
import {
	getPiDevAuth,
	loginPiDev,
	PI_DEV_PROFILE_SCOPES,
	PI_DEV_SETUP_PROFILE_CONNECTED_STATUS,
} from "../core/pi-dev/index.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { hasPendingSetupSteps } from "../core/setup-state.ts";
import { LoginDialogComponent } from "../modes/interactive/components/login-dialog.ts";
import { runSetupWizard } from "../modes/interactive/setup-wizard.ts";
import { initTheme } from "../modes/interactive/theme/theme.ts";

export interface StartupSetupResult {
	statusMessage?: string;
	errorMessage?: string;
}

async function showPiDevLoginDialog(options: {
	tui: TUI;
	container: Container;
	authStorage: AuthStorage;
	deviceId: string;
}): Promise<{ accessToken?: string; errorMessage?: string }> {
	const dialog = new LoginDialogComponent(
		options.tui,
		"pi.dev",
		(_success, _message) => {
			// Completion handled below.
		},
		"pi.dev",
		"Create pi.dev profile",
	);

	options.container.clear();
	options.container.addChild(dialog);
	options.tui.setFocus(dialog);
	options.tui.requestRender();

	try {
		const credential = await loginPiDev(options.authStorage, {
			scopes: PI_DEV_PROFILE_SCOPES,
			deviceId: options.deviceId,
			signal: dialog.signal,
			onDeviceCode: (info) => {
				dialog.showDeviceCode(info, { showUserCode: false });
				dialog.showWaiting("Waiting for authentication...");
			},
		});
		return { accessToken: credential.access };
	} catch (error: unknown) {
		if (dialog.signal.aborted) {
			return {};
		}
		const message = error instanceof Error ? error.message : String(error);
		return { errorMessage: `Failed to login to pi.dev: ${message}` };
	}
}

async function connectPiDevProfile(options: {
	tui: TUI;
	container: Container;
	settingsManager: SettingsManager;
	authStorage: AuthStorage;
}): Promise<{ accessToken?: string; errorMessage?: string }> {
	const deviceId = getStableActivitySyncDeviceId(options.settingsManager);
	await options.settingsManager.flush();

	const auth = await getPiDevAuth(options.authStorage, PI_DEV_PROFILE_SCOPES);
	let accessToken: string;
	if (auth.available) {
		accessToken = auth.accessToken;
	} else {
		const loginResult = await showPiDevLoginDialog({
			tui: options.tui,
			container: options.container,
			authStorage: options.authStorage,
			deviceId,
		});
		if (!loginResult.accessToken) {
			return { errorMessage: loginResult.errorMessage };
		}
		accessToken = loginResult.accessToken;
	}

	options.settingsManager.setActivitySyncEnabled(true);
	await options.settingsManager.flush();
	return { accessToken };
}

export async function runStartupSetupIfNeeded(options: {
	agentDir: string;
	settingsManager: SettingsManager;
	authStorage: AuthStorage;
	skip?: boolean;
}): Promise<StartupSetupResult> {
	if (
		options.skip === true ||
		process.stdin.isTTY !== true ||
		process.stdout.isTTY !== true ||
		Boolean(process.env.PI_OFFLINE) ||
		!hasPendingSetupSteps(options.agentDir, {
			themeConfigured: options.settingsManager.getTheme() !== undefined,
		})
	) {
		return {};
	}

	initTheme(options.settingsManager.getTheme());
	setKeybindings(KeybindingsManager.create());

	const tui = new TUI(new ProcessTerminal(), options.settingsManager.getShowHardwareCursor());
	tui.setClearOnShrink(options.settingsManager.getClearOnShrink());
	const container = new Container();
	tui.addChild(container);
	tui.start();

	try {
		const result = await runSetupWizard({
			tui,
			settingsManager: options.settingsManager,
			agentDir: options.agentDir,
			mode: "automatic",
			container,
		});

		if (!result.profileRequested) {
			return {};
		}

		const profileResult = await connectPiDevProfile({
			tui,
			container,
			settingsManager: options.settingsManager,
			authStorage: options.authStorage,
		});
		return {
			errorMessage: profileResult.errorMessage,
			statusMessage: profileResult.accessToken
				? PI_DEV_SETUP_PROFILE_CONNECTED_STATUS
				: "Setup complete. pi.dev profile setup skipped.",
		};
	} finally {
		tui.stop();
	}
}
