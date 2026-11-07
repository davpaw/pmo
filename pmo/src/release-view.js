/** Render live release catalog facts through the caller's safe html template. */
export const releaseFacts = (html, release, project) => {
  if (release?.state !== 'tagged') return html`<dt>Latest release tag</dt><dd>${release?.state === 'untagged' ? 'No reachable release tag' : 'Unavailable — refresh local git facts'}</dd>`
  const repository = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project?.repository ?? '') ? project.repository : null
  const url = repository ? `https://github.com/${repository}/tree/${encodeURIComponent(release.latestTag)}` : null
  return html`<dt>Latest release tag</dt><dd>${url ? html`<a href="${url}" target="_blank" rel="noreferrer">${release.latestTag}</a>` : release.latestTag} <span class="muted">(local git snapshot; publication not verified)</span></dd>
    <dt>Tag commit</dt><dd><code>${release.commit}</code></dd>
    <dt>Commits since release</dt><dd>${release.commitsSince} commits touching this module</dd>`
}