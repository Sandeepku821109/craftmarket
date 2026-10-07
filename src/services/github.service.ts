import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";

const GITHUB_API = "https://api.github.com";
const MAX_REPOSITORY_ARCHIVE_BYTES = 100 * 1024 * 1024;

export function validateGitHubRepositoryUrl(repositoryUrl: string, username: string): {
  owner: string;
  repository: string;
  canonicalUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw Object.assign(new Error("Enter a valid GitHub repository URL."), { statusCode: 400 });
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const repository = segments[1]?.replace(/\.git$/i, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    segments.length !== 2 ||
    !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(segments[0] || "") ||
    !/^[a-z\d_.-]+$/i.test(repository || "")
  ) {
    throw Object.assign(
      new Error("Use a GitHub repository URL in the format https://github.com/username/repository."),
      { statusCode: 400 }
    );
  }

  if (segments[0].toLowerCase() !== username.toLowerCase()) {
    throw Object.assign(new Error("GitHub username must match the owner in the repository URL."), {
      statusCode: 400,
    });
  }

  return {
    owner: segments[0],
    repository,
    canonicalUrl: `https://github.com/${segments[0]}/${repository}`,
  };
}

export async function verifyPublicGitHubRepository(repositoryUrl: string, username: string): Promise<string> {
  const { owner, repository, canonicalUrl } = validateGitHubRepositoryUrl(repositoryUrl, username);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Craftmarket-Repository-Verification",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("GitHub verification timed out. Please try again."), { statusCode: 503 });
    }
    throw Object.assign(new Error("Could not reach GitHub to verify the repository. Please try again."), {
      statusCode: 503,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw Object.assign(new Error("This GitHub repository was not found or is not public."), { statusCode: 400 });
  }
  if (response.status === 403 || response.status === 429) {
    throw Object.assign(new Error("GitHub verification is temporarily rate limited. Please try again shortly."), {
      statusCode: 503,
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("GitHub could not verify this repository. Please try again."), {
      statusCode: 503,
    });
  }

  const result: unknown = await response.json().catch(() => null);
  if (
    typeof result !== "object" ||
    result === null ||
    !("private" in result) ||
    result.private !== false ||
    !("owner" in result) ||
    typeof result.owner !== "object" ||
    result.owner === null ||
    !("login" in result.owner) ||
    typeof result.owner.login !== "string" ||
    result.owner.login.toLowerCase() !== username.toLowerCase()
  ) {
    throw Object.assign(new Error("GitHub repository owner could not be verified."), { statusCode: 400 });
  }

  return canonicalUrl;
}

export async function streamGitHubRepositoryArchive(
  reply: FastifyReply,
  repositoryUrl: string,
  filename: string
) {
  let parsedRepository: ReturnType<typeof validateGitHubRepositoryUrl>;
  try {
    const url = new URL(repositoryUrl);
    const username = url.pathname.split("/").filter(Boolean)[0] || "";
    parsedRepository = validateGitHubRepositoryUrl(repositoryUrl, username);
  } catch (error) {
    return reply.code(502).send({
      success: false,
      message: error instanceof Error ? error.message : "The saved GitHub repository URL is invalid.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(parsedRepository.owner)}/${encodeURIComponent(parsedRepository.repository)}/zipball`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Craftmarket-Project-Archive",
        },
        signal: controller.signal,
      }
    );
  } catch (error) {
    clearTimeout(timeout);
    return reply.code(502).send({
      success: false,
      message: error instanceof Error && error.name === "AbortError"
        ? "GitHub took too long to prepare the project archive."
        : "Could not connect to GitHub to load the project archive.",
    });
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    return reply.code(502).send({
      success: false,
      message: `GitHub could not load the project archive (HTTP ${response.status}).`,
    });
  }

  let archiveUrl: URL;
  try {
    archiveUrl = new URL(response.url);
  } catch {
    clearTimeout(timeout);
    return reply.code(502).send({ success: false, message: "GitHub returned an invalid project archive URL." });
  }
  if (
    archiveUrl.protocol !== "https:" ||
    archiveUrl.hostname !== "codeload.github.com" ||
    archiveUrl.username ||
    archiveUrl.password ||
    archiveUrl.port
  ) {
    clearTimeout(timeout);
    return reply.code(502).send({ success: false, message: "GitHub returned an untrusted project archive URL." });
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REPOSITORY_ARCHIVE_BYTES) {
    clearTimeout(timeout);
    return reply.code(413).send({ success: false, message: "The GitHub project archive exceeds the 100 MB download limit." });
  }

  const archiveStream = Readable.from((async function* () {
    const reader = response.body!.getReader();
    let totalBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_REPOSITORY_ARCHIVE_BYTES) {
          controller.abort();
          throw new Error("The GitHub project archive exceeds the 100 MB download limit.");
        }
        yield chunk.value;
      }
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
  })());

  reply
    .header("content-type", "application/zip")
    .header("content-disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}.zip"`)
    .header("cache-control", "private, no-store");
  const archiveLength = response.headers.get("content-length");
  if (archiveLength) reply.header("content-length", archiveLength);
  return reply.send(archiveStream);
}
