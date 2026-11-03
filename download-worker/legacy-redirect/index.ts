// Old name (Anonymizer by Shanoon): permanently redirect everything to the Anonymo download site.
export default {
  fetch(req: Request): Response {
    const url = new URL(req.url)
    const path = url.pathname
      .replace(/Anonymizer-Shanoon-Setup-/, 'Anonymo-Setup-')
      .replace(/Anonymizer-Shanoon-/, 'Anonymo-')
    return Response.redirect(`https://anonymo.shanoon.workers.dev${path}${url.search}`, 301)
  }
}
