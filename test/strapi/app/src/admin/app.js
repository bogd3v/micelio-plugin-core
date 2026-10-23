// The admin's interface languages besides English: Spanish, so the browser suite can render the
// plugin's pages in both of its locales (test/admin/status-page.test.ts). An admin locale is not
// hardening of the distribution, so it belongs in the clean Strapi (AGENTS.md, "Rules").
export default {
  config: { locales: ['es'] },
}
