import path from "path";
import os from "os";
import * as p from "@clack/prompts";
import OpenAI from "openai";
import { spawn } from "child_process";
import { template } from "./template";

export type Provider = "openai" | "openrouter";

async function editFile(filePath: string, onExit: () => void) {
	let editor =
		process.env.EDITOR ||
		(await p.select({
			message: "Select an editor",
			options: [
				{
					label: "vim",
					value: "vim",
				},
				{
					label: "nano",
					value: "nano",
				},
				{
					label: "cancel",
					value: "cancel",
				},
			],
		}));

	if (!editor || typeof editor !== "string" || editor === "cancel") {
		return;
	}

	let additionalArgs: string[] = [];
	if (/^(.[/\\])?code(.exe)?(\s+--.+)*/i.test(editor)) {
		editor = "code";
		additionalArgs = ["--wait"];
	}

	const child = spawn(editor, [filePath, ...additionalArgs], {
		stdio: "inherit",
	});

	await new Promise((resolve, reject) => {
		// biome-ignore lint/suspicious/noExplicitAny: unknown types to me
		child.on("exit", async (_e: any, _code: any) => {
			try {
				resolve(await onExit());
			} catch (error) {
				reject(error);
			}
		});
	});
}

function hasOwn<T extends object, K extends PropertyKey>(
	obj: T,
	key: K,
): obj is T & Record<K, unknown> {
	return key in obj && Object.prototype.hasOwnProperty.call(obj, key);
}

export const configPath = path.join(os.homedir(), ".bunnai");

export interface Config {
	provider: Provider;
	OPENAI_API_KEY: string;
	OPENROUTER_API_KEY: string;
	model: string;
	templates: Record<string, string>;
}

const DEFAULT_CONFIG: Config = {
	provider: "openai",
	OPENAI_API_KEY: "",
	OPENROUTER_API_KEY: "",
	model: "gpt-4-0125-preview",
	templates: {
		default: path.join(os.homedir(), ".bunnai-template"),
	},
};

export async function readConfigFile(): Promise<Config> {
	const fileExists = await Bun.file(configPath).exists();
	if (!fileExists) {
		return DEFAULT_CONFIG;
	}

	const configString = await Bun.file(configPath).text();
	const config = JSON.parse(configString);

	return {
		...DEFAULT_CONFIG,
		...config,
	};
}

function validateKeys(keys: string[]): asserts keys is (keyof Config)[] {
	const configKeys = Object.keys(DEFAULT_CONFIG);

	for (const key of keys) {
		if (!configKeys.includes(key)) {
			throw new Error(`Invalid config property: ${key}`);
		}
	}
}

export async function cleanUpTemplates(config: Config): Promise<Config> {
	for (const templateName in config.templates) {
		const templatePath = config.templates[templateName];
		const fileExists = await Bun.file(templatePath).exists();
		if (!fileExists) {
			delete config.templates[templateName];
		}
	}
	return config;
}

export async function setConfigs(
	keyValues: [key: keyof Config, value: Config[keyof Config]][],
) {
	const config = await readConfigFile();

	validateKeys(keyValues.map(([key]) => key));

	for (const [key, value] of keyValues) {
		// @ts-ignore
		config[key] = value;
	}

	await Bun.write(configPath, JSON.stringify(config));
}

export async function showConfigUI() {
	try {
		const config = await cleanUpTemplates(await readConfigFile());

		const choice = (await p.select({
			message: "set config",
			options: [
				{
					label: "Provider",
					value: "provider",
					hint: config.provider,
				},
				{
					label: "OpenAI API Key",
					value: "OPENAI_API_KEY",
					hint: hasOwn<Config, keyof Config>(config, "OPENAI_API_KEY")
						? maskKey(config.OPENAI_API_KEY, "sk-")
						: "not set",
				},
				{
					label: "OpenRouter API Key",
					value: "OPENROUTER_API_KEY",
					hint: hasOwn<Config, keyof Config>(config, "OPENROUTER_API_KEY")
						? maskKey(config.OPENROUTER_API_KEY, "sk-or-")
						: "not set",
				},
				{
					label: "Model",
					value: "model",
					hint: config.model,
				},
				{
					label: "Prompt Template",
					value: "template",
					hint: "edit the prompt template",
				},
				{
					label: "Cancel",
					value: "cancel",
					hint: "exit",
				},
			],
		})) as keyof Config | "template" | "cancel" | symbol;

		if (p.isCancel(choice)) {
			return;
		}

		if (choice === "provider") {
			const provider = await p.select({
				message: "Provider",
				options: [
					{
						label: "OpenAI",
						value: "openai",
					},
					{
						label: "OpenRouter (free models)",
						value: "openrouter",
					},
				],
				initialValue: config.provider,
			});

			await setConfigs([["provider", provider as Provider]]);
		} else if (choice === "OPENAI_API_KEY") {
			const apiKey = await p.text({
				message: "OpenAI API Key",
				initialValue: config.OPENAI_API_KEY,
			});

			await setConfigs([["OPENAI_API_KEY", apiKey as string]]);
		} else if (choice === "OPENROUTER_API_KEY") {
			const apiKey = await p.text({
				message: "OpenRouter API Key",
				initialValue: config.OPENROUTER_API_KEY,
			});

			await setConfigs([["OPENROUTER_API_KEY", apiKey as string]]);
		} else if (choice === "model") {
			const model = await p.select({
				message: "Model",
				options: (await getModels(config.provider)).map((model) => ({
					label: model,
					value: model,
				})),
				initialValue: config.model,
			});

			await setConfigs([["model", model as string]]);
		} else if (choice === "template") {
			const templateChoice = (await p.select({
				message: "Choose a template to edit",
				options: [
					...Object.keys(config.templates).map((name) => ({
						label: name,
						value: name,
					})),
					{ label: "Add new template", value: "add_new" },
					{ label: "Cancel", value: "cancel" },
				],
			})) as string;

			if (templateChoice === "add_new") {
				const newTemplateName = (await p.text({
					message: "New template name",
				})) as string;

				const newTemplatePath = path.join(
					os.homedir(),
					`.bunnai-template-${newTemplateName}`,
				);

				await Bun.write(newTemplatePath, template);
				config.templates[newTemplateName] = newTemplatePath;

				await editFile(newTemplatePath, async () => {
					console.log(`Prompt template '${newTemplateName}' updated`);
					await setConfigs([["templates", config.templates]]);
				});
			} else if (templateChoice !== "cancel") {
				const templatePath = config.templates[templateChoice];

				if (!(await Bun.file(templatePath).exists())) {
					await Bun.write(templatePath, template);
				}

				await editFile(templatePath, () => {
					console.log(`Prompt template '${templateChoice}' updated`);
				});
			}
		}

		if (p.isCancel(choice)) {
			return;
		}

		showConfigUI();
		// biome-ignore lint/suspicious/noExplicitAny: unknown types to me
	} catch (error: any) {
		console.error(`\n${error.message}\n`);
	}
}

function maskKey(value: string, prefix: string) {
	if (!value) {
		return "not set";
	}

	return `${prefix}...${value.slice(-3)}`;
}

interface OpenRouterModel {
	id: string;
	pricing?: {
		prompt?: string;
		completion?: string;
	};
}

interface OpenRouterModelsResponse {
	data?: OpenRouterModel[];
}

async function getModels(provider: Provider) {
	const config = await readConfigFile();

	if (provider === "openrouter") {
		if (!config.OPENROUTER_API_KEY) {
			throw new Error("OPENROUTER_API_KEY is not set");
		}

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
			},
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`,
			);
		}

		const body = (await response.json()) as OpenRouterModelsResponse;
		const freeModels = (body.data ?? [])
			.filter((model) => {
				const promptPrice = Number(model.pricing?.prompt ?? "1");
				const completionPrice = Number(model.pricing?.completion ?? "1");
				return (
					model.id.endsWith(":free") ||
					(promptPrice === 0 && completionPrice === 0)
				);
			})
			.map((model) => model.id)
			.sort((a, b) => a.localeCompare(b));

		if (freeModels.length === 0) {
			throw new Error("No free OpenRouter models found");
		}

		return freeModels;
	}

	if (!config.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set");
	}

	const oai = new OpenAI({
		apiKey: config.OPENAI_API_KEY,
	});

	const models = await oai.models.list();
	return models.data.map((model) => model.id);
}
