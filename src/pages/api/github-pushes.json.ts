import { execFileSync } from "node:child_process";
import type { APIRoute } from "astro";

export const prerender = true;

const repository = "MuyuDada/Firefly-yuan";
const branch = "master";
const windowSpec = "53 weeks ago";
const pageSize = 100;
const maxPages = 25;
const minLocalCommits = 10;

const readFromGit = (): string[] => {
	try {
		return execFileSync("git", ["log", "HEAD", `--since=${windowSpec}`, "--format=%cI"], {
			cwd: process.cwd(),
			encoding: "utf8",
			timeout: 20000,
		})
			.split(/\r?\n/)
			.map((value) => value.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

const readFromGitHub = async (): Promise<string[]> => {
	const since = new Date(Date.now() - 371 * 86400000).toISOString();
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "firefly-analytics-build",
	};
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}

	const dates: string[] = [];
	for (let page = 1; page <= maxPages; page++) {
		try {
			const response = await fetch(
				`https://api.github.com/repos/${repository}/commits?sha=${branch}&since=${since}&per_page=${pageSize}&page=${page}`,
				{ headers },
			);
			if (!response.ok) break;
			const items = (await response.json()) as Array<{
				commit?: { committer?: { date?: string }; author?: { date?: string } };
			}>;
			if (!Array.isArray(items) || items.length === 0) break;
			for (const item of items) {
				const date = item?.commit?.committer?.date ?? item?.commit?.author?.date;
				if (date) dates.push(date);
			}
			if (items.length < pageSize) break;
		} catch {
			break;
		}
	}
	return dates;
};

export const GET: APIRoute = async () => {
	const local = readFromGit();
	const useLocal = local.length >= minLocalCommits;
	const commits = useLocal ? local : await readFromGitHub();

	return new Response(
		JSON.stringify({
			ok: true,
			source: useLocal ? "local-git" : "github-api",
			repository,
			branch,
			generatedAt: new Date().toISOString(),
			commits,
		}),
		{
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, max-age=300",
			},
		},
	);
};
