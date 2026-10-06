const GITHUB_API = "https://api.github.com";

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
