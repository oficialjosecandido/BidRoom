describe('logger', () => {
  let originalEnv;
  let originalLog;
  let originalErr;
  let originalWarn;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    originalLog = console.log;
    originalErr = console.error;
    originalWarn = console.warn;
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    jest.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    console.log = originalLog;
    console.error = originalErr;
    console.warn = originalWarn;
  });

  it('emits info messages with fields in dev format', () => {
    process.env.NODE_ENV = 'development';
    const logger = require('../src/utils/logger');
    logger.info('hello', { foo: 'bar' });
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log.mock.calls[0][0]).toContain('[info]');
    expect(console.log.mock.calls[0][0]).toContain('hello');
    expect(console.log.mock.calls[0][0]).toContain('"foo":"bar"');
  });

  it('emits JSON lines in production', () => {
    process.env.NODE_ENV = 'production';
    const logger = require('../src/utils/logger');
    logger.info('hello', { foo: 'bar' });
    const line = console.log.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.foo).toBe('bar');
    expect(typeof parsed.ts).toBe('string');
  });

  it('captures stack traces from Error instances', () => {
    process.env.NODE_ENV = 'production';
    const logger = require('../src/utils/logger');
    logger.error(new Error('boom'));
    const line = console.error.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('boom');
    expect(parsed.stack).toMatch(/Error: boom/);
  });

  it('exposes child logger that mixes static context into every call', () => {
    process.env.NODE_ENV = 'production';
    const logger = require('../src/utils/logger');
    const child = logger.child({ requestId: 'abc' });
    child.warn('slow query', { ms: 1200 });
    const line = console.warn.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.requestId).toBe('abc');
    expect(parsed.ms).toBe(1200);
    expect(parsed.msg).toBe('slow query');
  });
});
