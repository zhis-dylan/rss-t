import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function blobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash('sha1').update(header).update(content).digest('hex');
}

function repositoryPath(repository) {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error('GITHUB_REPOSITORY must use the owner/repository format.');
  }
  return parts.map(encodeURIComponent).join('/');
}

async function responseError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body.message ?? '';
  } catch {
    detail = await response.text().catch(() => '');
  }
  return new Error(`GitHub API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
}

export function createGitHubPagesPublisher(config, { fetchImpl = fetch } = {}) {
  const { githubPagesToken: token, githubRepository: repository } = config;
  if (!token || !repository) return undefined;

  const repoPath = repositoryPath(repository);
  const branch = config.githubPagesBranch || 'gh-pages';
  const apiBase = `https://api.github.com/repos/${repoPath}`;
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'rss-t'
  };

  async function request(path, options = {}) {
    return fetchImpl(`${apiBase}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: AbortSignal.timeout(20_000)
    });
  }

  return async () => {
    const content = await readFile(config.outputPath);
    const contentsPath = `/contents/translated.xml?ref=${encodeURIComponent(branch)}`;
    const currentResponse = await request(contentsPath);
    let currentSha;

    if (currentResponse.ok) {
      const current = await currentResponse.json();
      currentSha = current.sha;
      if (currentSha === blobSha(content)) return 'unchanged';
    } else if (currentResponse.status === 404) {
      const branchResponse = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
      if (!branchResponse.ok) {
        if (branchResponse.status === 404) {
          throw new Error(`GitHub branch ${branch} does not exist. Create it before publishing.`);
        }
        throw await responseError(branchResponse);
      }
    } else {
      throw await responseError(currentResponse);
    }

    const body = {
      message: 'Update translated RSS',
      content: content.toString('base64'),
      branch
    };
    if (currentSha) body.sha = currentSha;

    const updateResponse = await request('/contents/translated.xml', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!updateResponse.ok) throw await responseError(updateResponse);
    return 'published';
  };
}

export { blobSha };
