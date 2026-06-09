import { Hono } from 'hono';

const files = new Hono<{ Bindings: Env }>();

files.get('/', c => {
  const url = c.env.FILES_TUNNEL_URL;
  if (!url) return c.json({ error: 'File server not configured' }, 503);
  if (!url.startsWith('http')) return c.json({ error: 'FILES_TUNNEL_URL must be a full URL starting with http(s)://' }, 500);
  return c.redirect(url, 302);
});

export default files;
