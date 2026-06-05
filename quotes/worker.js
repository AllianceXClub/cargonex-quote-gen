export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // root → generator
    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect(url.origin + '/generator.html', 302);
    }

    // generator.html + static assets
    if (url.pathname === '/generator.html' || url.pathname === '/quote-template-v1.html') {
      try { return await env.ASSETS.fetch(request); }
      catch (e) { return new Response('Not found', { status: 404 }); }
    }

    // quote files → Supabase Storage
    const filename = url.pathname.slice(1);
    if (filename.startsWith('quote-') && filename.endsWith('.html')) {
      const storageUrl = `${env.SUPABASE_URL}/storage/v1/object/quotes-html/${filename}`;
      const r = await fetch(storageUrl, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` }
      });
      if (!r.ok) return new Response('Not found', { status: 404 });
      const html = await r.text();
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
}