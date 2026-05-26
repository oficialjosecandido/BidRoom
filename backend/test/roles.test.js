describe('utils/roles', () => {
  let originalAdminEmails;
  let originalNodeEnv;

  beforeEach(() => {
    originalAdminEmails = process.env.ADMIN_EMAILS;
    originalNodeEnv = process.env.NODE_ENV;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('isAdminEmail', () => {
    it('returns true for emails in the list (case-insensitive)', () => {
      process.env.ADMIN_EMAILS = 'a@example.com,B@Example.com';
      const { isAdminEmail } = require('../src/utils/roles');
      expect(isAdminEmail('A@example.com')).toBe(true);
      expect(isAdminEmail('b@example.com')).toBe(true);
    });

    it('returns false for unknown emails', () => {
      process.env.ADMIN_EMAILS = 'a@example.com';
      const { isAdminEmail } = require('../src/utils/roles');
      expect(isAdminEmail('hacker@example.com')).toBe(false);
    });

    it('returns false for null/undefined/empty', () => {
      process.env.ADMIN_EMAILS = 'a@example.com';
      const { isAdminEmail } = require('../src/utils/roles');
      expect(isAdminEmail(null)).toBe(false);
      expect(isAdminEmail(undefined)).toBe(false);
      expect(isAdminEmail('')).toBe(false);
    });

    it('returns false for everyone when ADMIN_EMAILS is empty', () => {
      delete process.env.ADMIN_EMAILS;
      const { isAdminEmail } = require('../src/utils/roles');
      expect(isAdminEmail('a@example.com')).toBe(false);
    });
  });

  describe('requireAdmin middleware', () => {
    function build() {
      process.env.ADMIN_EMAILS = 'admin@example.com';
      return require('../src/utils/roles').requireAdmin;
    }

    const buildRes = () => {
      const res = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      return res;
    };

    it('returns 401 when no user is attached', () => {
      const requireAdmin = build();
      const req = {};
      const res = buildRes();
      const next = jest.fn();
      requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when the user is not in the admin list', () => {
      const requireAdmin = build();
      const req = { user: { email: 'other@example.com' } };
      const res = buildRes();
      const next = jest.fn();
      requireAdmin(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next when the user is an admin', () => {
      const requireAdmin = build();
      const req = { user: { email: 'admin@example.com' } };
      const res = buildRes();
      const next = jest.fn();
      requireAdmin(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
