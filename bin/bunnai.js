#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const entrypoint = path.resolve(__dirname, "../dist/index.js");

const result = spawnSync("bun", [entrypoint, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: process.env,
});

if (result.error) {
	if ("code" in result.error && result.error.code === "ENOENT") {
		console.error(
			"Bun runtime was not found in PATH. Install Bun and reopen your terminal: https://bun.sh",
		);
		process.exit(1);
	}

	console.error(`Failed to start Bun: ${result.error.message}`);
	process.exit(1);
}

if (typeof result.status === "number") {
	process.exit(result.status);
}

process.exit(1);
