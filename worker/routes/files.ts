import { Hono } from 'hono';
import { getActiveGameServer } from '../lib/strapi';

const files = new Hono<{ Bindings: Env }>();

files.get('/', async c => {
  const gameServer = await getActiveGameServer(c.env);
  const url = gameServer?.filesTunnelUrl;
  if (!url) return c.json({ error: 'File server not configured' }, 503);
  if (!url.startsWith('http')) return c.json({ error: 'filesTunnelUrl must be a full URL starting with http(s)://' }, 500);
  return c.redirect(url, 302);
});

export default files;
