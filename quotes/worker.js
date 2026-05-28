export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect root to generator
    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect(url.origin + '/generator.html', 302);
    }

    // Serve static assets for everything else
    return env.ASSETS.fetch(request);
  }
}
