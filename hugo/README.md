# Documentation Website

This is the source code for [https://alan-cha.github.io/silhouette-card-maker/](https://alan-cha.github.io/silhouette-card-maker/).

## Local Development

### Install Hextra

```sh
git submodule update --init --recursive
```

### Serve Website

```sh
hugo server serve -D
```

## GitHub Actions

The Pages workflow builds and uploads the Hugo site when `hugo/**` or the
workflow changes on `main`; `workflow_dispatch` always runs the build. The
build uses the repository's configured Pages URL when available. If Pages is
not configured, it still uploads a site artifact using the standard
`https://<owner>.github.io/<repository>/` URL (or the root URL for an
`<owner>.github.io` repository) and reports that deployment was skipped.

Deployment runs only when the Pages API reports the **GitHub Actions** build
source. If the site is configured for a different source, the artifact is still
built and uploaded, and the workflow explains how to switch the source. The
workflow does not change repository hosting settings. To enable deployment,
open **Settings > Pages** and set the build and deployment source to **GitHub
Actions**. Other API or permission failures remain visible as failed builds.
