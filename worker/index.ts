import { Hono } from 'hono';
import auth from './routes/auth';
import api from './routes/api';
import admin from './routes/admin';

const app = new Hono<{ Bindings: Env }>();

app.route('/auth', auth);
app.route('/api', api);
app.route('/admin', admin);

app.all('*', c => {
  const { pathname } = new URL(c.req.url);
  const target = pathname.includes('.') ? c.req.raw : new Request(new URL('/', c.req.url), c.req.raw);
  return c.env.ASSETS.fetch(target);
});

export default app;
