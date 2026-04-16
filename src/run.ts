import { $ } from "bun";
import OpenAI from "openai";
import { readConfigFile } from "./config";
import simpleGit from "simple-git";

interface RunOptions {
	verbose?: boolean;
}

const MAX_DIFF_CHARS = 32000;
const MAX_CHANGED_CONTEXT_LINES = 220;
const MAX_CHANGED_CONTEXT_CHARS = 12000;
const CHANGED_LINE_CONTEXT_RADIUS = 2;

function truncateWithNotice(input: string, maxChars: number, label: string) {
	if (input.length <= maxChars) {
		return input;
	}

	const omitted = input.length - maxChars;
	return `${input.slice(0, maxChars)}\n\n[${label}; omitted ${omitted} chars]`;
}

function isActualChangeLine(line: string) {
	if (line.startsWith("+++ ") || line.startsWith("--- ")) {
		return false;
	}

	return line.startsWith("+") || line.startsWith("-");
}

function extractChangedLinesContext(diff: string) {
	const lines = diff.split("\n");
	const output: string[] = [];

	let currentFileHeader: string[] = [];
	let fileHeaderEmitted = false;
	let pendingLeadingContext: string[] = [];
	let remainingTrailingContext = 0;

	const canAppend = (line: string) => {
		const projectedChars =
			output.reduce((sum, item) => sum + item.length + 1, 0) + line.length + 1;
		return (
			output.length < MAX_CHANGED_CONTEXT_LINES &&
			projectedChars <= MAX_CHANGED_CONTEXT_CHARS
		);
	};

	const append = (line: string) => {
		if (!canAppend(line)) {
			return false;
		}
		output.push(line);
		return true;
	};

	const emitFileHeaderIfNeeded = () => {
		if (fileHeaderEmitted) {
			return;
		}

		for (const headerLine of currentFileHeader) {
			if (!append(headerLine)) {
				return;
			}
		}
		fileHeaderEmitted = true;
	};

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			currentFileHeader = [line];
			fileHeaderEmitted = false;
			pendingLeadingContext = [];
			remainingTrailingContext = 0;
			continue;
		}

		if (
			currentFileHeader.length > 0 &&
			(line.startsWith("index ") ||
				line.startsWith("--- ") ||
				line.startsWith("+++ ") ||
				line.startsWith("new file mode ") ||
				line.startsWith("deleted file mode "))
		) {
			currentFileHeader.push(line);
			continue;
		}

		if (line.startsWith("@@")) {
			emitFileHeaderIfNeeded();
			if (!append(line)) {
				break;
			}
			pendingLeadingContext = [];
			remainingTrailingContext = 0;
			continue;
		}

		if (isActualChangeLine(line)) {
			emitFileHeaderIfNeeded();

			for (const contextLine of pendingLeadingContext) {
				if (!append(contextLine)) {
					break;
				}
			}
			pendingLeadingContext = [];

			if (!append(line)) {
				break;
			}
			remainingTrailingContext = CHANGED_LINE_CONTEXT_RADIUS;
			continue;
		}

		if (line.startsWith(" ")) {
			if (remainingTrailingContext > 0) {
				if (!append(line)) {
					break;
				}
				remainingTrailingContext -= 1;
			} else {
				pendingLeadingContext.push(line);
				if (pendingLeadingContext.length > CHANGED_LINE_CONTEXT_RADIUS) {
					pendingLeadingContext.shift();
				}
			}
			continue;
		}

		if (line.startsWith("\\ No newline at end of file")) {
			if (remainingTrailingContext > 0) {
				if (!append(line)) {
					break;
				}
				remainingTrailingContext -= 1;
			}
		}
	}

	if (output.length === 0) {
		return "(no focused changed-line context available)";
	}

	return truncateWithNotice(
		output.join("\n"),
		MAX_CHANGED_CONTEXT_CHARS,
		"changed-line context truncated",
	);
}

async function getStagedDiff(target_dir: string) {
	try {
		const git = simpleGit(target_dir);
		const diff = await git.diff(["--cached"]);

		return diff;
	} catch (error) {
		console.error("Error getting git diff:", error);
		throw error; // Re-throw the error after logging it
	}
}

export async function run(options: RunOptions, templateName?: string) {
	const config = await readConfigFile();
	if (options.verbose) {
		console.debug("Configuration loaded successfully.");
	}

	let templateFilePath: string;
	if (templateName) {
		if (!Object.prototype.hasOwnProperty.call(config.templates, templateName)) {
			console.error(
				`Error: Template '${templateName}' does not exist in the configuration.`,
			);
			process.exit(1);
		}
		templateFilePath = config.templates[templateName];
		if (options.verbose) {
			console.debug(`Using template: ${templateName}`);
		}
	} else {
		templateFilePath = config.templates.default;
		if (options.verbose) {
			console.debug("Using default template.");
		}
	}

	const templateFile = Bun.file(templateFilePath);
	if (!(await templateFile.exists())) {
		console.error(
			`Error: The template file '${templateFilePath}' does not exist.`,
		);
		process.exit(1);
	}
	if (options.verbose) {
		console.debug(`Template file found: ${templateFilePath}`);
	}

	const template = await templateFile.text();
	if (options.verbose) {
		console.debug("Template file read successfully.");
	}

	const target_dir = (await $`pwd`.text()).trim();
	if (options.verbose) {
		console.debug(`Target directory: ${target_dir}`);
	}

	if (!config.model) {
		console.error("Model is not set");
		process.exit(1);
	}

	const provider = config.provider ?? "openai";
	const apiKey =
		provider === "openrouter"
			? config.OPENROUTER_API_KEY
			: config.OPENAI_API_KEY;

	if (!apiKey) {
		console.error(
			provider === "openrouter"
				? "OPENROUTER_API_KEY is not set"
				: "OPENAI_API_KEY is not set",
		);
		process.exit(1);
	}

	const diff = await getStagedDiff(target_dir);
	if (options.verbose) {
		console.debug("Git diff retrieved:\n", diff);
	}

	if (diff.trim().length === 0) {
		console.error(`No changes to commit in ${target_dir}`);
		process.exit(1);
	}

	const trimmedDiff = truncateWithNotice(
		diff,
		MAX_DIFF_CHARS,
		"diff truncated",
	);
	const changedContext = extractChangedLinesContext(diff);

	let rendered_template = template
		.replace("{{diff}}", trimmedDiff)
		.replace("{{changed_context}}", changedContext);
	if (!template.includes("{{changed_context}}")) {
		rendered_template = `${rendered_template}

Additional bounded changed-line context (with nearby lines):
${changedContext}`;
	}
	if (options.verbose) {
		console.debug("Template rendered with git diff.");
	}

	const oai = new OpenAI({
		apiKey,
		...(provider === "openrouter"
			? { baseURL: "https://openrouter.ai/api/v1" }
			: {}),
	});

	try {
		if (options.verbose) {
			console.debug(`Sending request to ${provider}...`);
		}
		const response = await oai.chat.completions.create({
			messages: [
				{
					role: "system",
					content:
						"You generate commit message candidates from staged git changes. You will receive a full diff (sometimes truncated) and an additional bounded context excerpt centered on actual changed lines. Use both, prioritize the changed-line context when they conflict, infer intent at a higher level, and output exactly 10 single-line conventional commit candidates numbered 1..10 like `1. feat(scope): description`. Keep each line concise and actionable. Return only the numbered list with no extra prose.",
				},
				{
					role: "user",
					content: rendered_template,
				},
			],
			model: config.model,
		});

		if (options.verbose) {
			console.debug(`Response received from ${provider}.`);
			console.debug(JSON.stringify(response, null, 2));
		}

		const content = response.choices[0].message.content;
		if (!content) {
			console.error("Failed to generate commit message");
			process.exit(1);
		}

		console.log(content.trim());
		if (options.verbose) {
			console.debug("Commit message generated and outputted.");
		}
	} catch (error) {
		console.error(`Failed to fetch from ${provider}: ${error}`);
		process.exit(1);
	}
}
