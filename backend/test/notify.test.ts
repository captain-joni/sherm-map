import { describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/services/notify.ts';

describe('Webhook-Benachrichtigungen', () => {
  it('schickt JSON mit Token und tut ohne URL nichts', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    createNotifier('https://n8n.example/hook', 'geheim', fetchImpl)('sherm.submitted', { message: 'Hallo', url: 'x' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://n8n.example/hook');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer geheim');
    expect(JSON.parse(init.body as string)).toMatchObject({ source: 'sherm-map', event: 'sherm.submitted', message: 'Hallo', url: 'x' });

    const unused = vi.fn();
    createNotifier(null, null, unused)('report.created', { message: 'x' });
    expect(unused).not.toHaveBeenCalled();
  });

  it('wirft nie, auch wenn der Webhook nicht erreichbar ist', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    createNotifier('https://n8n.example/hook', null, async () => { throw new Error('ECONNREFUSED'); })('report.created', { message: 'x' });
    await new Promise(r => setTimeout(r, 10));
    expect(errors).toHaveBeenCalledWith('Webhook report.created: ECONNREFUSED');
    errors.mockRestore();
  });
});
