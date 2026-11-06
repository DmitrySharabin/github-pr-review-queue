import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	use: {
		baseURL: "http://127.0.0.1:8124",
	},
	projects: [
		{ name: "chromium" },
		// WebKit’s division falls just short of a whole number, e.g. 5 × 340 / 425, which the diffstat rounds down
		{ name: "webkit", use: { browserName: "webkit" }, grep: /diffstat/ },
	],
	// Not the README’s 8123, where a dev server may already run
	webServer: {
		command: "python3 -m http.server 8124 --bind 127.0.0.1",
		url: "http://127.0.0.1:8124",
		// The server logs every request there
		stderr: "ignore",
	},
});
